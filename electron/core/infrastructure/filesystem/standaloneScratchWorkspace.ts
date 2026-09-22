import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'

export interface StandaloneScratchExportResult {
  success: boolean
  path?: string
  error?: string
}

export interface StandaloneScratchCleanupResult {
  success: boolean
  removedEntries: number
  error?: string
}

function isInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function resolveStandaloneScratchBasePath(userDataPath?: string): string {
  return path.resolve(userDataPath?.trim() || path.join(os.homedir(), '.onlyrag_v2'))
}

export class StandaloneScratchWorkspace {
  private readonly customBasePath?: string

  constructor(customBasePath?: string) {
    this.customBasePath = customBasePath
  }

  getPath(): string {
    const electronUserDataPath = app && typeof app.getPath === 'function' ? app.getPath('userData') : undefined
    const basePath = resolveStandaloneScratchBasePath(this.customBasePath || electronUserDataPath)
    const scratchPath = path.join(basePath, 'agent-scratch')
    fs.mkdirSync(scratchPath, { recursive: true })
    return scratchPath
  }

  exportTo(destinationDirectory: string): StandaloneScratchExportResult {
    try {
      const sourcePath = path.resolve(this.getPath())
      const destinationRoot = path.resolve(destinationDirectory)
      if (!fs.existsSync(destinationRoot) || !fs.statSync(destinationRoot).isDirectory()) {
        return { success: false, error: 'La cartella di destinazione non esiste.' }
      }
      if (isInside(destinationRoot, sourcePath) || isInside(sourcePath, destinationRoot)) {
        return { success: false, error: 'Scegli una destinazione esterna al workspace scratch.' }
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
      const exportPath = path.join(destinationRoot, `OnlyRag-Scratch-${stamp}`)
      fs.cpSync(sourcePath, exportPath, {
        recursive: true,
        errorOnExist: true,
        force: false,
        verbatimSymlinks: false,
        filter: (entry) => !fs.lstatSync(entry).isSymbolicLink(),
      })
      return { success: true, path: exportPath }
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  clear(): StandaloneScratchCleanupResult {
    const scratchPath = this.getPath()
    try {
      const entries = fs.readdirSync(scratchPath)
      for (const entry of entries) {
        fs.rmSync(path.join(scratchPath, entry), { recursive: true, force: true })
      }
      return { success: true, removedEntries: entries.length }
    } catch (error: unknown) {
      return {
        success: false,
        removedEntries: 0,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

export const standaloneScratchWorkspace = new StandaloneScratchWorkspace()
