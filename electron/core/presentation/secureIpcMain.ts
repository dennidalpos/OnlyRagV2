import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import {
  sidecarExportPayloadSchema,
  sidecarIngestFilePayloadSchema,
  sidecarPagePreviewPayloadSchema,
  sidecarSearchPayloadSchema,
  sidecarTranslatePayloadSchema,
  sidecarUpdateDocumentPayloadSchema,
} from '../domain/sidecarContract'
import { promptHistoryIndexPayloadSchema, promptHistorySearchPayloadSchema } from '../domain/promptHistoryContract'
import {
  workspaceExecutePowerShellPayloadSchema,
  workspaceListFilesPayloadSchema,
  workspaceReadFilePayloadSchema,
  workspaceWriteFilePayloadSchema,
} from '../domain/workspaceContract'
import { artifactsDeletePayloadSchema, artifactsGetPayloadSchema, artifactsListPayloadSchema, artifactsSavePayloadSchema } from '../domain/artifactContract'
import { agentPlanSchema, agentTaskRequestSchema, planMilestoneSchema } from '../domain/agent/agentTaskContract'
import type { IpcInvokeChannel, IpcReceivedPayload, IpcResult, IpcSendChannel, IpcSendContract } from '../../../shared/ipc/ipcContract'

let mainWindow: (() => BrowserWindow | null) | null = null
export function setTrustedIpcWindowProvider(provider: () => BrowserWindow | null): void {
  mainWindow = provider
}

export function isTrustedIpcSender(event: Pick<IpcMainEvent | IpcMainInvokeEvent, 'sender' | 'senderFrame'>): boolean {
  const contents = mainWindow?.()?.webContents
  return Boolean(contents && event.sender === contents && event.senderFrame && event.senderFrame === contents.mainFrame)
}

const string = z.string().max(120_000)
const path = z.string().trim().min(1).max(4096)
const short = z.string().trim().min(1).max(1024)
const optionalPath = path.nullish()
const optionalString = string.optional()
const optionalBoolean = z.boolean().optional()
const optionalNumber = z.number().finite().optional()
const jsonValue = z.union([z.json(), z.undefined()])
const identity = z.object({ runId: short, conversationId: short, planRevisionId: short, workspaceId: short })
const settings = z
  .object({
    defaultModel: string.optional(),
    ollamaHost: string.optional(),
    language: z.enum(['it', 'en']).optional(),
    hasCompletedInitialSetup: z.boolean().optional(),
  })
  .passthrough()
const session = z
  .object({
    id: short,
    workspacePath: optionalPath,
    title: string,
    createdAt: short,
    updatedAt: short,
    actionLogs: z.array(jsonValue),
    executedPrompts: z.array(jsonValue),
  })
  .passthrough()
const customHub = z.object({ name: short, url: z.url(), type: z.enum(['builtin', 'json-catalog', 'github-repo']).optional(), description: string.optional() })
// Display-only hub metadata may pass through; the fields read by fetchSkillContent (downloadUrl, rawContent) are validated.
const hubSkill = z
  .object({
    id: short,
    name: short,
    description: string,
    category: short,
    tags: z.array(string),
    triggers: z.array(string),
    version: short,
    author: string,
    downloadUrl: z.url().max(4096).optional(),
    rawContent: z.string().max(2_000_000).optional(),
  })
  .passthrough()
const customSkill = z
  .object({
    name: short,
    content: string,
    description: string.optional(),
    version: short.optional(),
    author: string.optional(),
    triggers: z.array(string).optional(),
    tags: z.array(string).optional(),
    originHub: short.optional(),
    originHubId: short.optional(),
    originChecksum: short.optional(),
    isModified: z.boolean().optional(),
  })
  .passthrough()
const debugBundle = z.object({
  sessionId: short,
  workspacePath: optionalPath,
  settings: settings.optional(),
  activeModelName: optionalString,
  activeSkills: z.array(short).optional(),
})
const generationOptions = z
  .object({
    num_ctx: optionalNumber,
    temperature: optionalNumber,
    top_p: optionalNumber,
    repeat_penalty: optionalNumber,
    num_thread: optionalNumber,
    keep_alive: optionalString,
    think: optionalBoolean,
  })
  .strict()
  .optional()
const interviewAnswer = z.object({
  questionId: short,
  questionText: string,
  selectedOption: string,
  isCustom: z.boolean().optional(),
  provenance: z.enum(['explicit', 'accepted_recommendation', 'unconfirmed_assumption']).optional(),
})
const interviewQuestion = z.object({
  id: short,
  question: string,
  rationale: string,
  options: z.array(string).max(20),
  recommendedIndex: z.number().int().nonnegative(),
})
const obj = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()
const host = obj({ host: optionalString }).optional()
const modelOnHost = obj({ modelName: short, host: optionalString })
const workspaceRootOnly = obj({ workspaceRoot: optionalPath }).optional()
const workspacePathOnly = obj({ workspacePath: optionalPath }).optional()
const skillInWorkspace = obj({ skillId: short, workspaceRoot: optionalPath })
const docId = obj({ docId: sidecarUpdateDocumentPayloadSchema.shape.docId })

/** One schema per channel of the contract (`null`: the channel takes no payload); the compiler rejects a missing channel. */
const payloadSchemas: Record<IpcInvokeChannel | IpcSendChannel, z.ZodType | null> = {
  'settings:get': null,
  'settings:save': settings,
  'sidecar:restart': null,
  'dialog:open-file': obj({
    title: string.optional(),
    filters: z
      .array(z.object({ name: short, extensions: z.array(short).max(30) }))
      .max(30)
      .optional(),
  }).optional(),
  'dialog:open-directory': obj({ title: string.optional() }).optional(),
  'system:open-external': obj({ url: z.url() }),
  'system:open-path': obj({ targetPath: path }),
  'system:check-disk-space': obj({ models: z.array(short).max(100) }),
  'task:cancel': obj({ taskId: optionalString }).optional(),
  'workspace:get-standalone-scratch': null,
  'workspace:clear-standalone-scratch': null,
  'workspace:inspect-guest-os': null,
  'workspace:export-standalone-scratch': obj({ destinationDirectory: path }),
  'workspace:list-files': workspaceListFilesPayloadSchema.optional(),
  'workspace:read-file': workspaceReadFilePayloadSchema,
  'workspace:write-file': workspaceWriteFilePayloadSchema,
  'workspace:get-git-status-and-diff': obj({ workspaceRoot: path.optional() }).optional(),
  'workspace:init-git': obj({ workspaceRoot: path.optional() }).optional(),
  'workspace:execute-powershell': workspaceExecutePowerShellPayloadSchema,
  'projects:register': obj({ projectPath: path, name: optionalString }),
  'projects:list': null,
  'projects:touch': obj({ projectPath: path }),
  'projects:rename': obj({ projectPath: path, name: short }),
  'projects:remove': obj({ projectPath: path }),
  'sessions:list': workspacePathOnly,
  'sessions:save': session,
  'sessions:delete': obj({ sessionId: short, workspacePath: optionalPath }),
  'sessions:clear': workspacePathOnly,
  'artifacts:list': artifactsListPayloadSchema,
  'artifacts:get': artifactsGetPayloadSchema,
  'artifacts:save': artifactsSavePayloadSchema,
  'artifacts:delete': artifactsDeletePayloadSchema,
  'skills:list-sources': null,
  'skills:list-installed': workspaceRootOnly,
  'skills:add-custom-source': customHub,
  'skills:remove-custom-source': obj({ sourceId: short }),
  'skills:list-hub-by-source': obj({ sourceId: short, workspaceRoot: optionalPath, forceRefresh: optionalBoolean }),
  'skills:list-hub-all': obj({ workspaceRoot: optionalPath, forceRefresh: optionalBoolean }).optional(),
  'skills:get-hub-skill-content': hubSkill,
  'skills:toggle-active': obj({ skillId: short, isActive: z.boolean() }),
  'skills:install-from-hub': obj({ hubSkillId: short, workspaceRoot: optionalPath, hubSourceId: optionalString }),
  'skills:install-from-url': obj({ url: z.url(), workspaceRoot: optionalPath, customName: optionalString }),
  'skills:save-custom': obj({ input: customSkill, workspaceRoot: optionalPath }),
  'skills:reset-original': skillInWorkspace,
  'skills:uninstall': skillInWorkspace,
  'agent:start-task': agentTaskRequestSchema,
  'agent:cancel-task': identity,
  'agent:approval-response': obj({ identity, approved: z.boolean(), approvedHunkIndices: z.array(z.number().int().nonnegative()).optional() }),
  'agent:compact-context': identity,
  'agent:get-queue-status': null,
  'agent:logs-analyze': obj({ extraPaths: z.array(path).optional() }).optional(),
  'agent:plan-interview': obj({
    prompt: string,
    model: optionalString,
    settings,
    workspacePath: optionalPath,
    previousDecisions: z.array(interviewAnswer).max(50).optional(),
    identity: identity.optional(),
  }),
  'agent:plan-enrich-prompt': obj({ prompt: string, answers: z.array(interviewAnswer).max(50), questions: z.array(interviewQuestion).max(50) }),
  'agent:plan-generate': obj({
    prompt: string,
    model: optionalString,
    settings,
    previousPlan: agentPlanSchema.optional(),
    workspacePath: optionalPath,
    previousDecisions: z.array(interviewAnswer).max(50).optional(),
    identity: identity.optional(),
  }),
  'agent:plan-cancel': identity,
  'agent:get-plan-state': obj({ sessionId: short, workspacePath: optionalPath, planRevisionId: optionalString }),
  'agent:restore-checkpoint': obj({ workspacePath: path, checkpointId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/) }),
  'agent:plan-seed': obj({
    sessionId: short,
    workspacePath: path.nullable(),
    planMilestones: z.array(planMilestoneSchema).max(100),
    userTask: optionalString,
    planRevisionId: optionalString,
  }),
  'agent:export-ai-debug-bundle': debugBundle,
  'agent:skill-install-response': identity.extend({ requestId: short, approved: z.boolean() }),
  'diagnostics:get-logs': null,
  'diagnostics:clear-logs': null,
  'diagnostics:clear-agent-audit-log': null,
  'diagnostics:get-log-filepath': null,
  'diagnostics:open-logs-folder': null,
  'diagnostics:run': host,
  'diagnostics:log-telemetry': obj({ level: short, category: short, message: string }),
  'ollama:install-or-launch': null,
  'ollama:cancel-pull': null,
  'ollama:get-generation-status': null,
  'ollama:pull-model': modelOnHost,
  'ollama:delete-model': modelOnHost,
  'ollama:cancel-stream': obj({ operationId: short }),
  'ollama:generate-stream': obj({ model: short, prompt: string, options: generationOptions, host: optionalString, operationId: short }),
  'ollama:get-model-metrics': host,
  'ollama:get-running-models': host,
  'ollama:unload-model': modelOnHost,
  'ollama:test-connection': host,
  'ollama:check-model-updates': host,
  'ingest:file': sidecarIngestFilePayloadSchema,
  'ingest:update': sidecarUpdateDocumentPayloadSchema,
  'ingest:translate-inplace': sidecarTranslatePayloadSchema,
  'ingest:page-preview': sidecarPagePreviewPayloadSchema,
  'ingest:list': null,
  'ingest:get': docId,
  'ingest:delete': docId,
  'ingest:search': sidecarSearchPayloadSchema,
  'ingest:export': sidecarExportPayloadSchema,
  'history:index': promptHistoryIndexPayloadSchema,
  'history:search': promptHistorySearchPayloadSchema,
}

/** Checks the arguments of one message (none, or a single payload) and returns the parsed payload. */
export function validateIpcPayload(channel: string, args: unknown[]): unknown {
  if (!Object.hasOwn(payloadSchemas, channel)) throw new Error(`Missing IPC payload schema for ${channel}`)
  const schema = payloadSchemas[channel as keyof typeof payloadSchemas]
  const [payload] = args
  if (args.length > 1) throw new Error(`Invalid IPC payload for ${channel}`)
  if (!schema) {
    if (payload !== undefined) throw new Error(`Invalid IPC payload for ${channel}`)
    return undefined
  }
  const result = schema.safeParse(payload)
  if (!result.success) throw new Error(`Invalid IPC payload for ${channel}`)
  return result.data
}

type InvokeListener<C extends IpcInvokeChannel> = (event: IpcMainInvokeEvent, payload: IpcReceivedPayload<C>) => IpcResult<C> | Promise<IpcResult<C>>

export const secureIpcMain = {
  handle<C extends IpcInvokeChannel>(channel: C, listener: InvokeListener<C>): void {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedIpcSender(event)) throw new Error(`Untrusted IPC sender: ${channel}`)
      return listener(event, validateIpcPayload(channel, args) as IpcReceivedPayload<C>)
    })
  },
  on<C extends IpcSendChannel>(channel: C, listener: (event: IpcMainEvent, payload: IpcSendContract[C]) => void): void {
    ipcMain.on(channel, (event, ...args) => {
      if (!isTrustedIpcSender(event)) return
      let payload: unknown
      try {
        payload = validateIpcPayload(channel, args)
      } catch {
        return
      }
      listener(event, payload as IpcSendContract[C])
    })
  },
}
