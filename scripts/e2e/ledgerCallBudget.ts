import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

type Phase = 'extraction' | 'planning'

/** One authorized campaign: reserve durably before forwarding, never refund failed calls. */
export class LedgerCallBudget {
  private active?: { phase: Phase; index: number; request: string; used: boolean }
  private counts = { extraction: 0, planning: 0 }
  private total = 0
  private directory: string
  private resumeUnspent: boolean
  private begun = new Set<string>()

  constructor(directory: string, resumeUnspent = false) {
    this.directory = directory
    this.resumeUnspent = resumeUnspent
    // Exclusive campaign ownership also prevents a restarted process from resetting counters.
    const owner = { maximum: 8, perPhase: 4, perOriginal: 1 }
    if (resumeUnspent) {
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'budget-owner.json'), 'utf8')), owner)
      assert(!fs.readdirSync(directory).some((file) => file.startsWith('dispatch-')), 'Continuation requires zero prior reservations')
    } else fs.writeFileSync(path.join(directory, 'budget-owner.json'), JSON.stringify(owner), { flag: 'wx', flush: true })
  }

  begin(phase: Phase, index: number, request: string) {
    assert(!this.active, 'A case is still active')
    assert(Number.isInteger(index) && index >= 0 && index < 4)
    const key = `${phase}-${index}`
    assert(!this.begun.has(key), 'Original already invoked in this process')
    const file = path.join(this.directory, `invocation-${phase}-${index}.json`)
    const invocation = { phase, index, request }
    if (this.resumeUnspent && fs.existsSync(file)) assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), invocation)
    else fs.writeFileSync(file, JSON.stringify(invocation), { flag: 'wx', flush: true })
    this.begun.add(key)
    this.active = { phase, index, request, used: false }
  }

  reserve(body: {
    model?: string
    think?: boolean
    options?: Record<string, unknown>
    messages?: Array<{ role: string; content: string }>
    format?: { properties?: Record<string, unknown> }
  }) {
    const active = this.active
    assert(active, 'No active confirmed original')
    assert(!active.used && this.counts[active.phase] < 4 && this.total < 8, 'Authorized one-call-per-original budget exhausted')
    assert.equal(body.model, 'qwen3.5:9b')
    assert.equal(body.think, true)
    assert.equal(body.options?.num_ctx, 16384)
    for (const [key, value] of Object.entries({ temperature: 1, top_p: 0.95, top_k: 20, min_p: 0, presence_penalty: 1.5, repeat_penalty: 1 })) {
      assert.equal(body.options?.[key], value, `Unexpected sampling: ${key}`)
    }
    const user = body.messages?.filter((message) => message.role === 'user')
    assert.equal(user?.length, 1, 'Unexpected generation input')
    assert.equal(JSON.parse(user![0].content).request, active.request)
    const properties = body.format?.properties
    assert(properties, 'Structured generation is required')
    if (active.phase === 'extraction') assert(properties.obligations, 'Only extraction is authorized for this case')
    else assert(properties.interventions && properties.coverageClaims && !properties.obligations, 'Only one plan candidate is authorized for this case')
    // Mark in memory first: a write failure must never admit another call in this process.
    active.used = true
    this.counts[active.phase]++
    const id = ++this.total
    const reservation = { id, phase: active.phase, index: active.index, reservedAt: new Date().toISOString(), request: body }
    fs.writeFileSync(path.join(this.directory, `dispatch-${id}.json`), JSON.stringify(reservation, null, 2), { flag: 'wx', flush: true })
    return reservation
  }

  end() {
    assert(this.active)
    this.active = undefined
  }

  snapshot() {
    return { total: this.total, ...this.counts, maximum: 8, maximumPerPhase: 4, maximumPerOriginal: 1 }
  }
}
