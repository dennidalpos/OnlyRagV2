import { ipcMain } from 'electron'
import { workspaceAppService } from '../application/workspaceAppService'

export function registerWorkspaceIpcHandlers() {
  ipcMain.handle('workspace:list-files', async (_event: unknown, targetPath?: string) => {
    return workspaceAppService.listFiles(targetPath)
  })

  ipcMain.handle('workspace:get-project-map', async (_event: unknown, dirPath: string) => {
    return workspaceAppService.getProjectMap(dirPath)
  })

  ipcMain.handle('workspace:read-file', async (_event: unknown, filePath: string, startLine?: number, endLine?: number) => {
    return workspaceAppService.readFile(filePath, startLine, endLine)
  })

  ipcMain.handle('workspace:write-file', async (_event: unknown, filePath: string, content: string) => {
    return workspaceAppService.writeFile(filePath, content)
  })

  ipcMain.handle('workspace:delete-file', async (_event: unknown, filePath: string) => {
    return workspaceAppService.deleteFile(filePath)
  })

  ipcMain.handle('workspace:replace-chunk', async (_event: unknown, filePath: string, targetContent: string, replacementContent: string) => {
    return workspaceAppService.replaceChunk(filePath, targetContent, replacementContent)
  })

  ipcMain.handle('workspace:multi-replace-chunks', async (_event: unknown, filePath: string, replacements: { targetContent: string; replacementContent: string }[]) => {
    return workspaceAppService.multiReplaceChunks(filePath, replacements)
  })

  ipcMain.handle('workspace:grep-search', async (_event: unknown, dirPath: string, query: string, isRegex?: boolean, caseInsensitive?: boolean) => {
    return workspaceAppService.grepSearch(dirPath, query, isRegex, caseInsensitive)
  })

  ipcMain.handle('workspace:inspect-guest-os', async () => {
    return workspaceAppService.inspectGuestOsEnvironment()
  })

  ipcMain.handle('workspace:search-web', async (_event: unknown, query: string, maxResults?: number) => {
    return workspaceAppService.searchWeb(query, maxResults)
  })

  ipcMain.handle('workspace:fetch-web', async (_event: unknown, url: string, maxChars?: number) => {
    return workspaceAppService.fetchWebContent(url, maxChars)
  })

  ipcMain.handle('workspace:download-file', async (_event: unknown, url: string, targetFilePath: string, workspaceRoot?: string) => {
    return workspaceAppService.downloadFile(url, targetFilePath, workspaceRoot)
  })

  ipcMain.handle('workspace:execute-powershell', async (_event: unknown, command: string, targetCwd?: string, timeoutMs?: number) => {
    return workspaceAppService.executePowerShellCommand(command, targetCwd, timeoutMs)
  })
}
