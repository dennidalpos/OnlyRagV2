import path from 'node:path'
import { app, BrowserWindow, dialog, shell } from 'electron'
import type { DesktopShellPort } from '../../domain/ports/desktopShellPort'

const dialogParent = (): BrowserWindow | null => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((win) => !win.isDestroyed()) ?? null

export const electronDesktopShell: DesktopShellPort = {
  openExternal: (url) => shell.openExternal(url),
  openPath: (targetPath) => shell.openPath(targetPath),
  showItemInFolder: (targetPath) => shell.showItemInFolder(targetPath),
  async showOpenDialog(request) {
    const parent = dialogParent()
    if (!parent) return []
    const result = await dialog.showOpenDialog(parent, request)
    return result.canceled ? [] : result.filePaths
  },
  async showSaveDialog(request) {
    const result = await dialog.showSaveDialog({
      title: request.title,
      defaultPath: path.join(app.getPath('downloads'), request.defaultFileName),
      filters: request.filters,
    })
    return result.canceled || !result.filePath ? null : result.filePath
  },
}
