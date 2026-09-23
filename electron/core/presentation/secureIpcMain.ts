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
import { artifactsSavePayloadSchema } from '../domain/artifactContract'
import { agentTaskRequestSchema, planMilestoneSchema } from '../domain/agent/agentTaskContract'

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
const emptyArgs = z.tuple([])
const identity = z.object({ runId: short, conversationId: short, planRevisionId: short, workspaceId: short })
const settings = z.object({
  defaultModel: string.optional(),
  ollamaHost: string.optional(),
  language: z.enum(['it', 'en']).optional(),
  hasCompletedInitialSetup: z.boolean().optional(),
}).passthrough()
const session = z.object({ id: short, workspacePath: optionalPath, title: string, createdAt: short, updatedAt: short, actionLogs: z.array(jsonValue), executedPrompts: z.array(jsonValue) }).passthrough()
const customHub = z.object({ name: short, url: z.url(), type: z.enum(['builtin', 'json-catalog', 'github-repo']).optional(), description: string.optional() })
// Display-only hub metadata may pass through; the fields read by fetchSkillContent (downloadUrl, rawContent) are validated.
const hubSkill = z.object({ id: short, name: short, description: string, category: short, tags: z.array(string), triggers: z.array(string), version: short, author: string, downloadUrl: z.url().max(4096).optional(), rawContent: z.string().max(2_000_000).optional() }).passthrough()
const customSkill = z.object({ name: short, content: string, description: string.optional(), version: short.optional(), author: string.optional(), triggers: z.array(string).optional(), tags: z.array(string).optional(), originHub: short.optional(), originHubId: short.optional(), originChecksum: short.optional(), isModified: z.boolean().optional() }).passthrough()
const plan = z.object({ formatVersion: z.literal(2), id: short, version: z.number().int().nonnegative(), prompt: string, objective: string }).passthrough()
const debugBundle = z.object({ sessionId: short, workspacePath: optionalPath, settings: settings.optional(), activeModelName: optionalString, activeSkills: z.array(short).optional() })
const generationOptions = z.object({ num_ctx: optionalNumber, temperature: optionalNumber, top_p: optionalNumber, repeat_penalty: optionalNumber, num_thread: optionalNumber, keep_alive: optionalString, think: optionalBoolean }).strict().optional()
const interviewAnswer = z.object({ questionId: short, questionText: string, selectedOption: string, isCustom: z.boolean().optional(), provenance: z.enum(['explicit', 'accepted_recommendation', 'unconfirmed_assumption']).optional() })
const interviewQuestion = z.object({ id: short, question: string, rationale: string, options: z.array(string).max(20), recommendedIndex: z.number().int().nonnegative() })
const sidecarIngest = sidecarIngestFilePayloadSchema.shape
const sidecarTranslate = sidecarTranslatePayloadSchema.shape
const sidecarSearch = sidecarSearchPayloadSchema.shape
const sidecarExport = sidecarExportPayloadSchema.shape

const payloadSchemas: Record<string, z.ZodType> = {
  'settings:get': emptyArgs,
  'settings:save': z.tuple([settings]),
  'sidecar:restart': emptyArgs,
  'dialog:open-file': z.tuple([z.object({ title: string.optional(), filters: z.array(z.object({ name: short, extensions: z.array(short).max(30) })).max(30).optional() }).optional()]),
  'dialog:open-directory': z.tuple([z.object({ title: string.optional() }).optional()]),
  'system:open-external': z.tuple([z.url()]),
  'system:open-path': z.tuple([path]),
  'system:check-disk-space': z.tuple([z.array(short).max(100)]),
  'task:cancel': z.tuple([optionalString]),
  'workspace:get-standalone-scratch': emptyArgs,
  'workspace:clear-standalone-scratch': emptyArgs,
  'workspace:inspect-guest-os': emptyArgs,
  'workspace:export-standalone-scratch': z.tuple([path]),
  'workspace:list-files': z.tuple([optionalPath]),
  'workspace:read-file': z.tuple([path, optionalNumber, optionalNumber]),
  'workspace:write-file': z.tuple([path, string, optionalString, optionalPath]),
  'workspace:replace-chunk': z.tuple([path, string, string]),
  'workspace:grep-search': z.tuple([path, string, optionalBoolean, optionalBoolean]),
  'workspace:search-web': z.tuple([string, optionalNumber]),
  'workspace:fetch-web': z.tuple([z.url(), optionalNumber]),
  'workspace:download-file': z.tuple([z.url(), path, optionalPath]),
  'workspace:get-git-status-and-diff': z.tuple([optionalPath]),
  'workspace:init-git': z.tuple([optionalPath]),
  'workspace:execute-powershell': z.tuple([string, optionalPath, optionalNumber]),
  'projects:register': z.tuple([path, optionalString]),
  'projects:list': emptyArgs,
  'projects:touch': z.tuple([path]),
  'projects:rename': z.tuple([path, short]),
  'projects:remove': z.tuple([path]),
  'projects:migrate-legacy': z.tuple([jsonValue]),
  'sessions:list': z.tuple([optionalPath]),
  'sessions:save': z.tuple([session]),
  'sessions:delete': z.tuple([short, optionalPath]),
  'sessions:clear': z.tuple([optionalPath]),
  'sessions:migrate-legacy': z.tuple([jsonValue]),
  'artifacts:list': z.tuple([path]),
  'artifacts:get': z.tuple([path, short]),
  'artifacts:save': z.tuple([path, artifactsSavePayloadSchema.shape.input]),
  'artifacts:delete': z.tuple([path, short]),
  'skills:list-sources': emptyArgs,
  'skills:list-installed': z.tuple([optionalPath]),
  'skills:add-custom-source': z.tuple([customHub]),
  'skills:remove-custom-source': z.tuple([short]),
  'skills:list-hub-by-source': z.tuple([short, optionalPath, optionalBoolean]),
  'skills:list-hub-all': z.tuple([optionalPath, optionalBoolean]),
  'skills:get-hub-skill-content': z.tuple([hubSkill]),
  'skills:toggle-active': z.tuple([short, z.boolean()]),
  'skills:install-from-hub': z.tuple([short, optionalPath, optionalString]),
  'skills:install-from-url': z.tuple([z.url(), optionalPath, optionalString]),
  'skills:save-custom': z.tuple([customSkill, optionalPath]),
  'skills:reset-original': z.tuple([short, optionalPath]),
  'skills:uninstall': z.tuple([short, optionalPath]),
  'agent:start-task': z.tuple([agentTaskRequestSchema]),
  'agent:cancel-task': z.tuple([identity]),
  'agent:approval-response': z.tuple([identity, z.boolean(), z.array(z.number().int().nonnegative()).optional()]),
  'agent:compact-context': z.tuple([identity]),
  'agent:get-queue-status': emptyArgs,
  'agent:parse-tool-call': z.tuple([string]),
  'agent:logs-analyze': z.tuple([z.array(path).optional()]),
  'agent:plan-interview': z.tuple([string, optionalString, settings, optionalPath, z.array(interviewAnswer).max(50).optional(), identity.optional()]),
  'agent:plan-enrich-prompt': z.tuple([string, z.array(interviewAnswer).max(50), z.array(interviewQuestion).max(50)]),
  'agent:plan-generate': z.tuple([string, optionalString, settings, plan.optional(), optionalPath, z.array(interviewAnswer).max(50).optional(), identity.optional()]),
  'agent:plan-cancel': z.tuple([identity]),
  'agent:get-plan-state': z.tuple([short, optionalPath, optionalString]),
  'agent:plan-seed': z.tuple([short, optionalPath, z.array(planMilestoneSchema).max(100), optionalString, optionalString]),
  'agent:export-ai-debug-bundle': z.tuple([debugBundle]),
  'diagnostics:get-logs': emptyArgs,
  'diagnostics:clear-logs': emptyArgs,
  'diagnostics:clear-agent-audit-log': emptyArgs,
  'diagnostics:get-log-filepath': emptyArgs,
  'diagnostics:open-logs-folder': emptyArgs,
  'diagnostics:run': z.tuple([optionalString]),
  'diagnostics:log-telemetry': z.tuple([short, short, string]),
  'ollama:install-or-launch': emptyArgs,
  'ollama:cancel-pull': emptyArgs,
  'ollama:get-generation-status': emptyArgs,
  'ollama:pull-model': z.tuple([short, optionalString]),
  'ollama:delete-model': z.tuple([short, optionalString]),
  'ollama:cancel-stream': z.tuple([short]),
  'ollama:generate-stream': z.tuple([short, string, generationOptions, optionalString, optionalString]),
  'ollama:get-model-metrics': z.tuple([optionalString]),
  'ollama:get-running-models': z.tuple([optionalString]),
  'ollama:unload-model': z.tuple([short, optionalString]),
  'ollama:test-connection': z.tuple([optionalString]),
  'ollama:check-model-updates': z.tuple([optionalString]),
  'ingest:file': z.tuple([sidecarIngest.filePath, sidecarIngest.visionModel, sidecarIngest.visionPrompt, sidecarIngest.normalizeWithLlm, sidecarIngest.normalizationModel, sidecarIngest.numCtx, sidecarIngest.taskId, sidecarIngest.normalizationThink]),
  'ingest:update': z.tuple([sidecarUpdateDocumentPayloadSchema.shape.docId, sidecarUpdateDocumentPayloadSchema.shape.markdownContent]),
  'ingest:translate-inplace': z.tuple([sidecarTranslate.docId, sidecarTranslate.sourceLang, sidecarTranslate.targetLang, sidecarTranslate.model, sidecarTranslate.targetDir, sidecarTranslate.numCtx, sidecarTranslate.think]),
  'ingest:page-preview': z.tuple([sidecarPagePreviewPayloadSchema.shape.docId, sidecarPagePreviewPayloadSchema.shape.pageNumber]),
  'ingest:list': emptyArgs,
  'ingest:delete': z.tuple([sidecarUpdateDocumentPayloadSchema.shape.docId]),
  'ingest:search': z.tuple([sidecarSearch.query, sidecarSearch.topK, sidecarSearch.docIds]),
  'ingest:export': z.tuple([sidecarExport.markdownContent, sidecarExport.format, sidecarExport.outputFolder]),
  'history:index': z.tuple([promptHistoryIndexPayloadSchema]),
  'history:search': z.tuple([promptHistorySearchPayloadSchema.shape.query, promptHistorySearchPayloadSchema.shape.topK, promptHistorySearchPayloadSchema.shape.projectPaths]),
  'agent:skill-install-response': z.tuple([identity.extend({ requestId: short, approved: z.boolean() })]),
}

export function validateIpcPayload(channel: string, args: unknown[]): void {
  const schema = payloadSchemas[channel]
  if (!schema) throw new Error(`Missing IPC payload schema for ${channel}`)
  if (!schema.safeParse(args).success) throw new Error(`Invalid IPC payload for ${channel}`)
}

export const secureIpcMain = {
  handle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedIpcSender(event)) throw new Error(`Untrusted IPC sender: ${channel}`)
      validateIpcPayload(channel, args)
      return listener(event, ...args)
    })
  },
  on(channel: string, listener: Parameters<typeof ipcMain.on>[1]): void {
    ipcMain.on(channel, (event, ...args) => {
      if (!isTrustedIpcSender(event)) return
      try {
        validateIpcPayload(channel, args)
      } catch {
        return
      }
      listener(event, ...args)
    })
  },
}
