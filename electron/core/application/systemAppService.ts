import fs from 'node:fs'
import path from 'node:path'
import { app, dialog, BrowserWindow } from 'electron'
import { logger } from '../../diagnostics'
import { taskRunner } from '../infrastructure/process/taskRunner'

export interface DiskSpaceCheckResult {
  allowed: boolean
  requiredGB: number
  freeGB: number
  missingGB: number
  error?: string
}

export class SystemAppService {
  getOllamaStoragePath(): string {
    if (process.env.OLLAMA_MODELS && fs.existsSync(process.env.OLLAMA_MODELS)) {
      return process.env.OLLAMA_MODELS
    }
    const homeDir = process.env.USERPROFILE || process.env.HOME || ''
    const standardOllamaModelsDir = path.join(homeDir, '.ollama', 'models')
    if (fs.existsSync(standardOllamaModelsDir)) {
      return standardOllamaModelsDir
    }
    if (fs.existsSync(homeDir)) {
      return homeDir
    }
    try {
      return app.getPath('userData')
    } catch {
      return process.platform === 'win32' ? 'C:\\' : '/'
    }
  }

  estimateModelSizeBytes(modelName: string): number {
    const name = modelName.toLowerCase()
    let sizeGB = 4.8

    if (name.includes('nomic')) {
      sizeGB = 0.3
    } else if (name.includes('mxbai')) {
      sizeGB = 0.7
    } else if (name.includes('bge-m3')) {
      sizeGB = 1.1
    } else if (name.includes('embed') || name.includes('minilm')) {
      sizeGB = 0.5
    } else if (name.includes('1b') || name.includes('1.5b')) {
      sizeGB = 1.2
    } else if (name.includes('3b') || name.includes('moondream') || name.includes('phi')) {
      sizeGB = 2.2
    } else if (name.includes('7b') || name.includes('8b') || name.includes('llava') || name.includes('minicpm')) {
      sizeGB = 4.8
    } else if (name.includes('11b') || name.includes('14b')) {
      sizeGB = 8.5
    } else if (name.includes('32b') || name.includes('33b')) {
      sizeGB = 20.0
    } else if (name.includes('70b')) {
      sizeGB = 40.0
    }

    return sizeGB * 1024 * 1024 * 1024
  }

  getDiskFreeSpace(targetPath?: string): { freeBytes: number; totalBytes: number } {
    try {
      const dir = targetPath || this.getOllamaStoragePath()
      if (fs.statfsSync) {
        const stats = fs.statfsSync(dir)
        const freeBytes = stats.bavail * stats.bsize
        const totalBytes = stats.blocks * stats.bsize
        return { freeBytes, totalBytes }
      }
    } catch (err: any) {
      logger.log('WARN', 'SystemApp', `fs.statfsSync failed for ${targetPath}: ${err.message}`)
    }

    return { freeBytes: 100 * 1024 * 1024 * 1024, totalBytes: 500 * 1024 * 1024 * 1024 }
  }

  validateModelDownloadSpace(models: string[]): DiskSpaceCheckResult {
    try {
      const { freeBytes } = this.getDiskFreeSpace()
      const freeGB = Number((freeBytes / (1024 * 1024 * 1024)).toFixed(2))

      let requiredBytes = 0
      for (const m of models) {
        if (m && m.trim()) {
          requiredBytes += this.estimateModelSizeBytes(m.trim())
        }
      }

      const safetyBufferBytes = 2 * 1024 * 1024 * 1024
      const totalNeededBytes = requiredBytes + safetyBufferBytes
      const requiredGB = Number((requiredBytes / (1024 * 1024 * 1024)).toFixed(2))

      const allowed = freeBytes >= totalNeededBytes
      const missingBytes = Math.max(0, totalNeededBytes - freeBytes)
      const missingGB = Number((missingBytes / (1024 * 1024 * 1024)).toFixed(2))

      logger.log('INFO', 'SystemApp', `Disk space check: Free=${freeGB}GB, Required=${requiredGB}GB, Allowed=${allowed}`)

      return {
        allowed,
        requiredGB,
        freeGB,
        missingGB,
      }
    } catch (err: any) {
      logger.log('ERROR', 'SystemApp', `Failed disk space check: ${err.message}`)
      return {
        allowed: true,
        requiredGB: 0,
        freeGB: 100,
        missingGB: 0,
        error: err.message,
      }
    }
  }

  async applyOllamaEnvironmentVariables(
    variables: { name: string; value: string }[],
    restartOllama: boolean = false
  ): Promise<{ success: boolean; appliedCount: number; message: string; error?: string }> {
    if (!Array.isArray(variables) || variables.length === 0) {
      return { success: false, appliedCount: 0, message: 'Nessuna variabile fornita' }
    }

    try {
      logger.log('INFO', 'SystemApp', `Applying ${variables.length} Ollama environment variable(s)`)

      if (process.platform === 'win32') {
        const psCommands: string[] = []
        for (const v of variables) {
          if (v && v.name && v.value !== undefined) {
            // Update current process env
            process.env[v.name] = v.value
            // Build PowerShell command to persist User environment variable
            const safeName = v.name.replace(/'/g, "''")
            const safeVal = String(v.value).replace(/'/g, "''")
            psCommands.push(`[System.Environment]::SetEnvironmentVariable('${safeName}', '${safeVal}', 'User')`)
          }
        }

        if (restartOllama) {
          psCommands.push(`Stop-Process -Name "ollama*" -Force -ErrorAction SilentlyContinue`)
          psCommands.push(`Start-Sleep -Seconds 1`)
          psCommands.push(`if (Test-Path "$env:LOCALAPPDATA\\Programs\\Ollama\\ollama app.exe") { Start-Process -FilePath "$env:LOCALAPPDATA\\Programs\\Ollama\\ollama app.exe" } elseif (Get-Command ollama -ErrorAction SilentlyContinue) { Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden }`)
        }

        const scriptPayload = psCommands.join('; ')
        const execRes = await taskRunner.executePowerShellCommand(scriptPayload)

        if (!execRes.success && execRes.error) {
          logger.log('WARN', 'SystemApp', `PowerShell set env warning: ${execRes.error}`)
        }
      } else {
        // Linux / macOS in-memory fallback
        for (const v of variables) {
          if (v && v.name && v.value !== undefined) {
            process.env[v.name] = String(v.value)
          }
        }
      }

      const restartMsg = restartOllama ? ' e demone Ollama riavviato' : '. Riavvia l\'app Ollama per rendere attive le modifiche'
      return {
        success: true,
        appliedCount: variables.length,
        message: `Impostate con successo ${variables.length} variabili d'ambiente utente${restartMsg}.`,
      }
    } catch (err: any) {
      logger.log('ERROR', 'SystemApp', `Failed applying environment variables: ${err.message}`)
      return {
        success: false,
        appliedCount: 0,
        message: `Errore durante l'impostazione delle variabili: ${err.message}`,
        error: err.message,
      }
    }
  }

  async openFileDialog(win: BrowserWindow | null, options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) {
    if (!win) return []
    const res = await dialog.showOpenDialog(win, {
      title: options?.title || 'Select Documents to Import',
      properties: ['openFile', 'multiSelections'],
      filters: options?.filters || [
        {
          name: 'Supported Documents',
          extensions: ['pdf', 'png', 'jpg', 'jpeg', 'docx', 'txt', 'md'],
        },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    return res.canceled ? [] : res.filePaths
  }

  async openDirectoryDialog(win: BrowserWindow | null, options?: { title?: string }) {
    if (!win) return null
    const res = await dialog.showOpenDialog(win, {
      title: options?.title || 'Select Workspace Directory',
      properties: ['openDirectory'],
    })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  }
}

export const systemAppService = new SystemAppService()
