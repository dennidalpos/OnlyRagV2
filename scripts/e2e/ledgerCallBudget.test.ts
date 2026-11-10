import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { LedgerCallBudget } from './ledgerCallBudget'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()))
    expect(path.basename(root)).toMatch(/^onlyrag-budget-unit-/)
    fs.rmSync(root, { recursive: true, force: true })
  }
})
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-budget-unit-'))
  roots.push(directory)
  return { directory, budget: new LedgerCallBudget(directory) }
}
function wire(planning = false) {
  return {
    model: 'qwen3.5:9b',
    think: true,
    options: { num_ctx: 16384, temperature: 1, top_p: 0.95, top_k: 20, min_p: 0, presence_penalty: 1.5, repeat_penalty: 1 },
    messages: [{ role: 'user', content: JSON.stringify({ request: 'Frozen original' }) }],
    format: { properties: planning ? { interventions: {}, coverageClaims: {} } : { obligations: {} } },
  }
}
it('reserves exactly eight distinct originals before forwarding and refuses retries or restart', () => {
  const { directory, budget } = fixture()
  for (const phase of ['extraction', 'planning'] as const) {
    for (let index = 0; index < 4; index++) {
      budget.begin(phase, index, 'Frozen original')
      const reservation = budget.reserve(wire(phase === 'planning'))
      expect(JSON.parse(fs.readFileSync(path.join(directory, `dispatch-${reservation.id}.json`), 'utf8'))).toEqual(reservation)
      expect(() => budget.reserve(wire(phase === 'planning'))).toThrow('budget exhausted')
      budget.end()
      expect(() => budget.begin(phase, index, 'Frozen original')).toThrow()
    }
  }
  expect(budget.snapshot()).toMatchObject({ total: 8, extraction: 4, planning: 4 })
  expect(() => new LedgerCallBudget(directory)).toThrow()
})
it('refuses scope, model, options and review calls without consuming an allowed call', () => {
  const { budget } = fixture()
  expect(() => budget.reserve(wire())).toThrow('No active')
  budget.begin('extraction', 0, 'Frozen original')
  expect(() => budget.reserve(wire(true))).toThrow('Only extraction')
  expect(() => budget.reserve({ ...wire(), model: 'other' })).toThrow()
  expect(() => budget.reserve({ ...wire(), think: false })).toThrow()
  expect(() => budget.reserve({ ...wire(), options: { ...wire().options, temperature: 0 } })).toThrow()
  expect(() => budget.reserve({ ...wire(), messages: [{ role: 'user', content: '{"request":"Other"}' }] })).toThrow()
  expect(budget.snapshot().total).toBe(0)
  budget.reserve(wire())
  budget.end()
  budget.begin('planning', 0, 'Frozen original')
  expect(() => budget.reserve({ ...wire(), format: { properties: { requirements: {} } } })).toThrow('Only one plan')
})
it('does not refund a reservation after a storage failure', () => {
  const { directory, budget } = fixture()
  budget.begin('extraction', 0, 'Frozen original')
  fs.mkdirSync(path.join(directory, 'dispatch-1.json'))
  expect(() => budget.reserve(wire())).toThrow()
  expect(() => budget.reserve(wire())).toThrow('budget exhausted')
  expect(budget.snapshot().total).toBe(1)
})
it('continues only a zero-reservation IPC failure without rewriting the owner or invocation', () => {
  const { directory, budget } = fixture()
  budget.begin('extraction', 0, 'Frozen original')
  const original = fs.readFileSync(path.join(directory, 'invocation-extraction-0.json'), 'utf8')
  const continued = new LedgerCallBudget(directory, true)
  continued.begin('extraction', 0, 'Frozen original')
  continued.reserve(wire())
  continued.end()
  expect(() => continued.begin('extraction', 0, 'Frozen original')).toThrow('already invoked')
  expect(fs.readFileSync(path.join(directory, 'invocation-extraction-0.json'), 'utf8')).toBe(original)
  expect(() => new LedgerCallBudget(directory, true)).toThrow('zero prior reservations')
})
