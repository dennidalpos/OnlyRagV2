import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { agentTaskRequestSchema } from '../../domain/agent/agentTaskContract'
import type { AgentRunIdentity, AgentTaskRecovery, AgentTaskRequest } from '../../../../shared/types'
import { matchesAgentRunIdentity } from '../../../../shared/domain/agent/agentRunIdentity'
import { safeAtomicWrite } from './safeAtomicFileWriter'
import { userDataRoot } from './userDataRoot'
import { sanitizeAppSettings } from '../../domain/settings/appSettingsDomain'
import { resolveAgentCapabilityProfile } from '../../../../shared/domain/agent/agentCapabilityProfile'

const entrySchema = z
  .object({
    identity: agentTaskRequestSchema.shape.identity,
    request: agentTaskRequestSchema.optional(),
    status: z.enum(['pending', 'terminal', 'abandoned']),
    acceptedAt: z.string().datetime(),
    abandonment: z
      .object({ at: z.string().datetime(), evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/), evidence: z.string() })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.status === 'pending' && (!entry.request || !matchesAgentRunIdentity(entry.identity, entry.request.identity))) {
      ctx.addIssue({ code: 'custom', message: 'Pending task identity/request mismatch' })
    }
    if (entry.status === 'abandoned' && (!entry.request || !entry.abandonment)) {
      ctx.addIssue({ code: 'custom', message: 'Abandoned task must retain its intent and evidence' })
    }
    if (
      entry.request &&
      (!entry.request.workspacePath ||
        !path.isAbsolute(entry.request.workspacePath) ||
        (entry.request.sessionId && entry.request.sessionId !== entry.identity.conversationId))
    ) {
      ctx.addIssue({ code: 'custom', message: 'Retained request has an invalid workspace or conversation' })
    }
  })
const ledgerSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema).max(10_000) }).strict()
type Ledger = z.infer<typeof ledgerSchema>
const operations = new Map<string, Promise<unknown>>()
const MAX_BYTES = 64 * 1024 * 1024

/** Accepted tasks survive process loss; terminal identities are retained to refuse replay. */
export class AgentTaskRecoveryRepository {
  constructor(private readonly resolvePath = () => path.join(userDataRoot(), 'agent-task-recovery.json')) {}

  private read(): Ledger {
    const target = this.resolvePath()
    if (!fs.existsSync(target)) return { version: 1, entries: [] }
    if (fs.statSync(target).size > MAX_BYTES) throw new Error('Agent recovery ledger exceeds its size limit; existing data is preserved.')
    const ledger = ledgerSchema.parse(JSON.parse(fs.readFileSync(target, 'utf8')))
    if (new Set(ledger.entries.map((entry) => entry.identity.runId)).size !== ledger.entries.length) {
      throw new Error('Agent recovery ledger contains duplicate run identities; existing data is preserved.')
    }
    return ledger
  }

  private async update(change: (ledger: Ledger) => void): Promise<void> {
    const target = path.resolve(this.resolvePath())
    const previous = operations.get(target) || Promise.resolve()
    const operation = previous
      .catch(() => {})
      .then(async () => {
        const ledger = this.read()
        change(ledger)
        const content = JSON.stringify(ledgerSchema.parse(ledger), null, 2)
        if (Buffer.byteLength(content) > MAX_BYTES) throw new Error('Agent recovery ledger is full; existing data is preserved.')
        if (!(await safeAtomicWrite(target, content))) throw new Error('Agent recovery ledger could not be saved.')
      })
    operations.set(target, operation)
    try {
      await operation
    } finally {
      if (operations.get(target) === operation) operations.delete(target)
    }
  }

  async accept(request: AgentTaskRequest): Promise<void> {
    const validated = agentTaskRequestSchema.parse(request)
    await this.update((ledger) => {
      if (ledger.entries.some((entry) => entry.identity.runId === validated.identity.runId)) {
        throw new Error('Agent run already accepted; use explicit recovery for an interrupted task.')
      }
      ledger.entries.push({ identity: validated.identity, request: validated, status: 'pending', acceptedAt: new Date().toISOString() })
    })
  }

  list(): AgentTaskRecovery[] {
    return this.read()
      .entries.filter((entry) => entry.status === 'pending')
      .map((entry) => ({
        identity: entry.identity,
        userTask: entry.request!.userTask,
        workspacePath: entry.request!.workspacePath || '',
        agentMode: entry.request!.agentMode,
        acceptedAt: entry.acceptedAt,
        activeModel: entry.request!.activeModel,
        capabilityProfile: resolveAgentCapabilityProfile(entry.request!.capabilityProfile || sanitizeAppSettings(entry.request!.settings)),
      }))
  }

  load(identity: AgentRunIdentity): AgentTaskRequest {
    const entry = this.read().entries.find((candidate) => candidate.identity.runId === identity.runId)
    if (!entry || entry.status !== 'pending' || !entry.request || !matchesAgentRunIdentity(entry.identity, identity)) {
      throw new Error('No interrupted task matches this run identity.')
    }
    const request = entry.request as AgentTaskRequest
    return { ...request, ...(request.settings ? { settings: sanitizeAppSettings(request.settings) } : {}) }
  }

  async finish(identity: AgentRunIdentity): Promise<void> {
    await this.update((ledger) => {
      const entry = ledger.entries.find((candidate) => matchesAgentRunIdentity(candidate.identity, identity))
      if (!entry) throw new Error('Accepted agent task is missing from recovery ledger.')
      if (entry.status === 'abandoned') throw new Error('Abandoned evidence cannot be retired as ordinary completion.')
      entry.status = 'terminal'
      delete entry.request
    })
  }

  isAbandoned(identity: AgentRunIdentity): boolean {
    return this.read().entries.some((entry) => matchesAgentRunIdentity(entry.identity, identity) && entry.status === 'abandoned')
  }

  async abandon(identity: AgentRunIdentity, evidenceDigest: string, evidence: string): Promise<void> {
    await this.update((ledger) => {
      const entry = ledger.entries.find((candidate) => matchesAgentRunIdentity(candidate.identity, identity))
      if (!entry || entry.status !== 'pending') throw new Error('No pending task matches this abandonment.')
      entry.status = 'abandoned'
      entry.abandonment = { at: new Date().toISOString(), evidenceDigest, evidence }
    })
    const retained = this.read().entries.find((entry) => matchesAgentRunIdentity(entry.identity, identity))
    if (retained?.status !== 'abandoned' || retained.abandonment?.evidenceDigest !== evidenceDigest || retained.abandonment.evidence !== evidence) {
      throw new Error('Abandonment archive readback failed; do not repeat the interrupted action.')
    }
  }
}

export const agentTaskRecoveryRepository = new AgentTaskRecoveryRepository()
