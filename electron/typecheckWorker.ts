import { parentPort } from 'node:worker_threads'
import { type TypecheckRequest, type TypecheckResponse, WorkspaceIncrementalTypecheck } from './core/infrastructure/process/workspaceIncrementalTypecheck'

// Worker-thread entry for WorkspaceTypecheckWorkerClient: messages arrive one at a time, so the
// per-workspace Program cache is never used concurrently.
const checker = new WorkspaceIncrementalTypecheck()

parentPort?.on('message', (request: TypecheckRequest) => {
  const response: TypecheckResponse = { id: request.id, diagnostic: checker.checkWrittenFile(request.workspacePath, request.filePath) }
  parentPort?.postMessage(response)
})
