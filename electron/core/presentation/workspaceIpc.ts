import { ipcMain } from 'electron'
import { workspaceAppService } from '../application/workspaceAppService'
import {
  workspaceDownloadFilePayloadSchema,
  workspaceExecutePowerShellPayloadSchema,
  workspaceFetchWebPayloadSchema,
  workspaceGrepSearchPayloadSchema,
  workspaceListFilesPayloadSchema,
  workspaceMultiReplaceChunksPayloadSchema,
  workspaceProjectMapPayloadSchema,
  workspaceReadFilePayloadSchema,
  workspaceReplaceChunkPayloadSchema,
  workspaceSearchWebPayloadSchema,
  workspaceWriteFilePayloadSchema,
  workspaceGitCommitPayloadSchema,
} from '../domain/workspaceContract'

export function registerWorkspaceIpcHandlers() {
  ipcMain.handle('workspace:list-files', async (_event: unknown, targetPath?: string) => {
    const payload = workspaceListFilesPayloadSchema.parse({ targetPath })
    return workspaceAppService.listFiles(payload.targetPath)
  })

  ipcMain.handle('workspace:get-project-map', async (_event: unknown, dirPath: string) => {
    const payload = workspaceProjectMapPayloadSchema.parse({ dirPath })
    return workspaceAppService.getProjectMap(payload.dirPath)
  })

  ipcMain.handle('workspace:read-file', async (_event: unknown, filePath: string, startLine?: number, endLine?: number) => {
    const payload = workspaceReadFilePayloadSchema.parse({ filePath, startLine, endLine })
    return workspaceAppService.readFile(payload.filePath, payload.startLine, payload.endLine)
  })

  ipcMain.handle('workspace:write-file', async (_event: unknown, filePath: string, content: string) => {
    const payload = workspaceWriteFilePayloadSchema.parse({ filePath, content })
    return workspaceAppService.writeFile(payload.filePath, payload.content)
  })

  ipcMain.handle('workspace:replace-chunk', async (_event: unknown, filePath: string, targetContent: string, replacementContent: string) => {
    const payload = workspaceReplaceChunkPayloadSchema.parse({ filePath, targetContent, replacementContent })
    return workspaceAppService.replaceChunk(payload.filePath, payload.targetContent, payload.replacementContent)
  })

  ipcMain.handle('workspace:multi-replace-chunks', async (_event: unknown, filePath: string, replacements: { targetContent: string; replacementContent: string }[]) => {
    const payload = workspaceMultiReplaceChunksPayloadSchema.parse({ filePath, replacements })
    return workspaceAppService.multiReplaceChunks(payload.filePath, payload.replacements)
  })

  ipcMain.handle('workspace:grep-search', async (_event: unknown, dirPath: string, query: string, isRegex?: boolean, caseInsensitive?: boolean) => {
    const payload = workspaceGrepSearchPayloadSchema.parse({ dirPath, query, isRegex, caseInsensitive })
    return workspaceAppService.grepSearch(payload.dirPath, payload.query, payload.isRegex, payload.caseInsensitive)
  })

  ipcMain.handle('workspace:inspect-guest-os', async () => {
    return workspaceAppService.inspectGuestOsEnvironment()
  })

  ipcMain.handle('workspace:search-web', async (_event: unknown, query: string, maxResults?: number) => {
    const payload = workspaceSearchWebPayloadSchema.parse({ query, maxResults })
    return workspaceAppService.searchWeb(payload.query, payload.maxResults)
  })

  ipcMain.handle('workspace:fetch-web', async (_event: unknown, url: string, maxChars?: number) => {
    const payload = workspaceFetchWebPayloadSchema.parse({ url, maxChars })
    return workspaceAppService.fetchWebContent(payload.url, payload.maxChars)
  })

  ipcMain.handle('workspace:download-file', async (_event: unknown, url: string, targetFilePath: string, workspaceRoot?: string) => {
    const payload = workspaceDownloadFilePayloadSchema.parse({ url, targetFilePath, workspaceRoot })
    return workspaceAppService.downloadFile(payload.url, payload.targetFilePath, payload.workspaceRoot)
  })

  ipcMain.handle('workspace:git-commit', async (_event: unknown, commitMessage: string, workspaceRoot?: string) => {
    const payload = workspaceGitCommitPayloadSchema.parse({ commitMessage, workspaceRoot })
    return workspaceAppService.gitCommit(payload.workspaceRoot, payload.commitMessage)
  })

  ipcMain.handle('workspace:get-git-status-and-diff', async (_event: unknown, workspaceRoot?: string) => {
    return workspaceAppService.getGitStatusAndDiff(workspaceRoot)
  })

  ipcMain.handle('workspace:init-git', async (_event: unknown, workspaceRoot?: string) => {
    return workspaceAppService.initGitRepository(workspaceRoot)
  })

  ipcMain.handle('workspace:execute-powershell', async (_event: unknown, command: string, targetCwd?: string, timeoutMs?: number) => {
    const payload = workspaceExecutePowerShellPayloadSchema.parse({ command, targetCwd, timeoutMs })
    return workspaceAppService.executePowerShellCommand(payload.command, payload.targetCwd, payload.timeoutMs)
  })
}
