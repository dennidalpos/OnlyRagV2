import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'

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
const genericArgs = z.array(jsonValue).max(8)
const object = z.record(z.string(), jsonValue)
const optionalObject = object.optional()

const payloadSchemas: Record<string, z.ZodType> = {
  'settings:save': z.tuple([object]),
  'system:open-external': z.tuple([z.url()]),
  'system:open-path': z.tuple([path]),
  'system:check-disk-space': z.tuple([z.array(short).max(100)]),
  'dialog:open-file': z.tuple([optionalObject]),
  'dialog:open-directory': z.tuple([optionalObject]),
  'task:cancel': z.tuple([optionalString]),
  'workspace:export-standalone-scratch': z.tuple([path]),
  'workspace:list-files': z.tuple([optionalPath]),
  'workspace:get-project-map': z.tuple([path]),
  'workspace:read-file': z.tuple([path, optionalNumber, optionalNumber]),
  'workspace:write-file': z.tuple([path, string, optionalString, optionalPath]),
  'workspace:replace-chunk': z.tuple([path, string, string]),
  'workspace:multi-replace-chunks': z.tuple([path, z.array(z.object({ targetContent: string, replacementContent: string })).max(100)]),
  'workspace:grep-search': z.tuple([path, string, optionalBoolean, optionalBoolean]),
  'workspace:search-web': z.tuple([string, optionalNumber]),
  'workspace:fetch-web': z.tuple([z.url(), optionalNumber]),
  'workspace:download-file': z.tuple([z.url(), path, optionalPath]),
  'workspace:git-commit': z.tuple([short, optionalPath, z.array(path).max(1000)]),
  'workspace:get-git-status-and-diff': z.tuple([optionalPath]),
  'workspace:init-git': z.tuple([optionalPath]),
  'workspace:execute-powershell': z.tuple([string, optionalPath, optionalNumber]),
  'projects:register': z.tuple([path, optionalString]),
  'projects:touch': z.tuple([path]),
  'projects:rename': z.tuple([path, short]),
  'projects:remove': z.tuple([path]),
  'projects:migrate-legacy': z.tuple([jsonValue]),
  'sessions:list': z.tuple([optionalPath]),
  'sessions:save': z.tuple([object]),
  'sessions:delete': z.tuple([short, optionalPath]),
  'sessions:clear': z.tuple([optionalPath]),
  'sessions:migrate-legacy': z.tuple([jsonValue]),
  'artifacts:list': z.tuple([path]),
  'artifacts:get': z.tuple([path, short]),
  'artifacts:save': z.tuple([path, object]),
  'artifacts:delete': z.tuple([path, short]),
  'skills:list-installed': z.tuple([optionalPath]),
  'skills:add-custom-source': z.tuple([object]),
  'skills:remove-custom-source': z.tuple([short]),
  'skills:list-hub-by-source': z.tuple([short, optionalPath, optionalBoolean]),
  'skills:list-hub-all': z.tuple([optionalPath, optionalBoolean]),
  'skills:get-hub-skill-content': z.tuple([object]),
  'skills:toggle-active': z.tuple([short, z.boolean()]),
  'skills:install-from-hub': z.tuple([short, optionalPath, optionalString]),
  'skills:install-from-url': z.tuple([z.url(), optionalPath, optionalString]),
  'skills:save-custom': z.tuple([object, optionalPath]),
  'skills:reset-original': z.tuple([short, optionalPath]),
  'skills:uninstall': z.tuple([short, optionalPath]),
  'agent:start-task': z.tuple([object]),
  'agent:cancel-task': z.tuple([object]),
  'agent:approval-response': z.tuple([object, z.boolean(), z.array(z.number().int().nonnegative()).optional()]),
  'agent:compact-context': z.tuple([object]),
  'agent:parse-tool-call': z.tuple([string]),
  'agent:logs-analyze': z.tuple([z.array(path).optional()]),
  'agent:plan-cancel': z.tuple([object]),
  'agent:get-plan-state': z.tuple([short, optionalPath, optionalString]),
  'agent:export-ai-debug-bundle': z.tuple([object]),
  'diagnostics:run': z.tuple([optionalString]),
  'diagnostics:log-telemetry': z.tuple([short, short, string]),
  'ollama:pull-model': z.tuple([short, optionalString]),
  'ollama:delete-model': z.tuple([short, optionalString]),
  'ollama:cancel-stream': z.tuple([short]),
  'ollama:generate-stream': z.tuple([short, string, optionalObject, optionalString, optionalString]),
  'ollama:benchmark-model': z.tuple([short, optionalString]),
  'ollama:get-model-metrics': z.tuple([optionalString]),
  'ollama:get-running-models': z.tuple([optionalString]),
  'ollama:unload-model': z.tuple([short, optionalString]),
  'ollama:test-connection': z.tuple([optionalString]),
  'ollama:check-model-updates': z.tuple([optionalString]),
  'skill-install:response': z.tuple([object]),
}

export function validateIpcPayload(channel: string, args: unknown[]): void {
  const schema = payloadSchemas[channel] || genericArgs
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
