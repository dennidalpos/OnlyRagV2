import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sanitizeLogMessage } from '../../../logRedactor'
import {
  capabilityPolicyAuditEventSchema,
  type CapabilityPolicyAuditEvent,
  type CapabilityPolicyAuditStore,
} from '../../domain/agent/capabilityPolicyContract'
import { safeAtomicWrite } from '../filesystem/safeAtomicFileWriter'

const FILE_NAME = 'capability_policy_audit.json'
const MAX_EVENTS = 1000

function defaultPath(): string {
  return path.join(os.homedir(), '.onlyrag_v2', 'logs', FILE_NAME)
}

function redactEvent(event: CapabilityPolicyAuditEvent): CapabilityPolicyAuditEvent {
  return {
    ...event,
    reason: sanitizeLogMessage(event.reason),
    target: event.target ? sanitizeLogMessage(event.target) : undefined,
  }
}

export class CapabilityPolicyAuditRepository implements CapabilityPolicyAuditStore {
  private writeQueue: Promise<unknown> = Promise.resolve()

  constructor(private readonly filePath: string = defaultPath()) {}

  public async append(event: CapabilityPolicyAuditEvent): Promise<boolean> {
    const parsed = capabilityPolicyAuditEventSchema.safeParse(event)
    if (!parsed.success) return false

    const operation = this.writeQueue.then(async () => {
      const current = await this.load()
      const next = [...current, redactEvent(parsed.data)].slice(-MAX_EVENTS)
      return safeAtomicWrite(this.filePath, JSON.stringify(next, null, 2))
    })
    this.writeQueue = operation.catch(() => undefined)
    return operation
  }

  public async load(): Promise<CapabilityPolicyAuditEvent[]> {
    try {
      if (!fs.existsSync(this.filePath)) return []
      const raw = await fs.promises.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.flatMap((event) => {
        const result = capabilityPolicyAuditEventSchema.safeParse(event)
        return result.success ? [result.data] : []
      })
    } catch {
      return []
    }
  }
}
