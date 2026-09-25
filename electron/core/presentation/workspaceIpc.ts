import { secureIpcMain as ipcMain } from './secureIpcMain'
import { workspaceAppService } from '../application/workspaceAppService'

export function registerWorkspaceIpcHandlers() {
  ipcMain.handle('workspace:get-standalone-scratch', async () => {
    return workspaceAppService.getStandaloneScratchWorkspace()
  })

  ipcMain.handle('workspace:export-standalone-scratch', async (_event, { destinationDirectory }) => {
    return workspaceAppService.exportStandaloneScratchWorkspace(destinationDirectory)
  })

  ipcMain.handle('workspace:clear-standalone-scratch', async () => {
    return workspaceAppService.clearStandaloneScratchWorkspace()
  })

  ipcMain.handle('workspace:list-files', async (_event, payload) => {
    return workspaceAppService.listFiles(payload?.dirPath)
  })

  ipcMain.handle('workspace:read-file', async (_event, { filePath, startLine, endLine }) => {
    return workspaceAppService.readFile(filePath, startLine, endLine)
  })

  ipcMain.handle('workspace:write-file', async (_event, { filePath, content, expectedContentHash, workspaceRoot }) => {
    return workspaceAppService.writeFile(filePath, content, expectedContentHash, workspaceRoot)
  })

  ipcMain.handle('workspace:inspect-guest-os', async () => {
    return workspaceAppService.inspectGuestOsEnvironment()
  })

  ipcMain.handle('workspace:get-git-status-and-diff', async (_event, payload) => {
    return workspaceAppService.getGitStatusAndDiff(payload?.workspaceRoot)
  })

  ipcMain.handle('workspace:init-git', async (_event, payload) => {
    return workspaceAppService.initGitRepository(payload?.workspaceRoot)
  })

  ipcMain.handle('workspace:execute-powershell', async (_event, { command, cwd, timeoutMs }) => {
    return workspaceAppService.executePowerShellCommand(command, cwd, timeoutMs)
  })
}
