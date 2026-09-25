import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC_EVENT_METHODS,
  IPC_INVOKE_METHODS,
  type IElectronAPI,
  type IpcEventChannel,
  type IpcEventContract,
  type IpcSendContract,
} from '../shared/ipc/ipcContract'

function subscribe<C extends IpcEventChannel>(channel: C, callback: (data: IpcEventContract[C]) => void): () => void {
  const listener = (_event: IpcRendererEvent, data: IpcEventContract[C]) => callback(data)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// Every invoke method forwards its single payload unchanged (no argument when omitted); Main validates it against the channel schema.
const invokeMethods = Object.fromEntries(
  Object.entries(IPC_INVOKE_METHODS).map(([method, channel]) => [
    method,
    (payload?: unknown) => (payload === undefined ? ipcRenderer.invoke(channel) : ipcRenderer.invoke(channel, payload)),
  ]),
)
const eventMethods = Object.fromEntries(
  Object.entries(IPC_EVENT_METHODS).map(([method, channel]) => [method, (callback: (data: unknown) => void) => subscribe(channel, callback)]),
)

const api = {
  ...invokeMethods,
  ...eventMethods,
  generateOllamaStream: async (request, onChunk, onDone) => {
    const operationId = request.operationId || crypto.randomUUID()
    const unsubscribeChunk = subscribe('ollama:chunk', (event) => {
      if (event.operationId === operationId) onChunk(event.chunk)
    })
    const unsubscribeDone = subscribe('ollama:done', (event) => {
      if (event.operationId === operationId) onDone?.()
    })
    try {
      return await ipcRenderer.invoke('ollama:generate-stream', { ...request, operationId })
    } finally {
      unsubscribeChunk()
      unsubscribeDone()
    }
  },
  respondAgentSkillInstall: (response: IpcSendContract['agent:skill-install-response']) => {
    ipcRenderer.send('agent:skill-install-response', response)
  },
} as IElectronAPI

contextBridge.exposeInMainWorld('electronAPI', api)
