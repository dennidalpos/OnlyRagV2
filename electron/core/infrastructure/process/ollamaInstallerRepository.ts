import { shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { logger } from '../logging/logger'
import { errorMessage } from '../../../../shared/domain/errors/errorMessage'

const OLLAMA_DOWNLOAD_PAGE = 'https://ollama.com/download/windows'

export type OllamaInstallOrLaunchResult = { success: true; action: 'launched' | 'manual-download' } | { success: false; error: string }

export class OllamaInstallerRepository {
  async installOrLaunch(): Promise<OllamaInstallOrLaunchResult> {
    logger.log('INFO', 'OllamaInstallerRepo', 'User requested Ollama launch or installation...')

    const localAppData = process.env.LOCALAPPDATA
    const localExe = localAppData ? path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe') : null
    const executable = localExe && fs.existsSync(localExe) ? localExe : 'ollama.exe'

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(executable, ['serve'], { detached: true, stdio: 'ignore' })
        child.once('spawn', () => {
          child.unref()
          resolve()
        })
        child.once('error', reject)
      })
      logger.log('INFO', 'OllamaInstallerRepo', `Ollama process started: ${executable}`)
      return { success: true, action: 'launched' }
    } catch (err: unknown) {
      logger.log('INFO', 'OllamaInstallerRepo', `Ollama launch unavailable: ${errorMessage(err)}`)
    }

    try {
      await shell.openExternal(OLLAMA_DOWNLOAD_PAGE)
      logger.log('INFO', 'OllamaInstallerRepo', 'Opened official Ollama Windows download page for manual installation.')
      return { success: true, action: 'manual-download' }
    } catch (err: unknown) {
      const message = `Could not open Ollama download page: ${errorMessage(err)}`
      logger.log('ERROR', 'OllamaInstallerRepo', message)
      return { success: false, error: message }
    }
  }
}

export const ollamaInstallerRepository = new OllamaInstallerRepository()
