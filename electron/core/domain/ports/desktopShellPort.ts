export interface FileDialogFilter {
  name: string
  extensions: string[]
}

export interface OpenDialogRequest {
  title: string
  properties: Array<'openFile' | 'openDirectory' | 'multiSelections'>
  filters?: FileDialogFilter[]
}

export interface SaveDialogRequest {
  title: string
  defaultFileName: string
  filters?: FileDialogFilter[]
}

/** Desktop integration used by application services; the Electron adapter lives in infrastructure/electron. */
export interface DesktopShellPort {
  openExternal(url: string): Promise<void>
  /** Resolves to an error message, or '' on success (Electron's shell.openPath contract). */
  openPath(targetPath: string): Promise<string>
  showItemInFolder(targetPath: string): void
  /** Resolves to the selected paths; empty when cancelled or when no application window exists. */
  showOpenDialog(request: OpenDialogRequest): Promise<string[]>
  /** Resolves to the chosen path, or null when cancelled. Defaults to the user's Downloads folder. */
  showSaveDialog(request: SaveDialogRequest): Promise<string | null>
}
