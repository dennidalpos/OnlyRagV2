import { app } from 'electron'
import path from 'node:path'
import https from 'node:https'
import http from 'node:http'
import fs from 'node:fs'
import { spawn, exec } from 'node:child_process'
import { logger, checkOllamaStatus } from '../../diagnostics'
import { ollamaHttpClient } from '../infrastructure/http/ollamaHttpClient'

export class OllamaAppService {
  installOrLaunchOllama(): Promise<{ success: boolean; message?: string; error?: string }> {
    logger.log('INFO', 'OllamaApp', 'User requested Ollama launch or installation...')

    const localAppData = process.env.LOCALAPPDATA || ''
    const possibleOllamaExes = [
      path.join(localAppData, 'Programs/Ollama/ollama app.exe'),
      path.join(localAppData, 'Programs/Ollama/ollama.exe'),
      'ollama.exe',
    ]

    for (const exePath of possibleOllamaExes) {
      if (exePath === 'ollama.exe' || fs.existsSync(exePath)) {
        try {
          logger.log('INFO', 'OllamaApp', `Attempting to launch Ollama: ${exePath}`)
          const p = spawn(exePath, ['serve'], { detached: true, stdio: 'ignore' })
          p.unref()
          return Promise.resolve({ success: true, message: 'Ollama launched.' })
        } catch (err: any) {
          logger.log('WARN', 'OllamaApp', `Failed launching ${exePath}: ${err.message}`)
        }
      }
    }

    const tempInstallerPath = path.join(app.getPath('temp'), 'OllamaSetup.exe')
    const downloadUrl = 'https://ollama.com/download/OllamaSetup.exe'
    logger.log('INFO', 'OllamaApp', `Downloading Ollama installer from ${downloadUrl}...`)

    return new Promise((resolve) => {
      const file = fs.createWriteStream(tempInstallerPath)

      const cleanupAndFail = (errMsg: string) => {
        try {
          if (fs.existsSync(tempInstallerPath)) fs.unlinkSync(tempInstallerPath)
        } catch (unlinkErr: any) {
          logger.log('WARN', 'OllamaApp', `Failed unlinking temp installer on error: ${unlinkErr.message}`)
        }
        logger.log('ERROR', 'OllamaApp', `Installer download failed: ${errMsg}`)
        resolve({ success: false, error: errMsg })
      }

      const handleResponse = (response: http.IncomingMessage) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location
          if (redirectUrl) {
            https.get(redirectUrl, handleResponse).on('error', (err) => cleanupAndFail(err.message))
            return
          }
        }
        if (response.statusCode !== 200) {
          cleanupAndFail(`HTTP status ${response.statusCode}`)
          return
        }

        response.pipe(file)
        file.on('finish', () => {
          file.close(() => {
            logger.log('INFO', 'OllamaApp', 'OllamaSetup.exe downloaded. Launching installer...')
            exec(`"${tempInstallerPath}"`, (err) => {
              if (err) logger.log('WARN', 'OllamaApp', `Installer closed: ${err.message}`)
              try {
                if (fs.existsSync(tempInstallerPath)) fs.unlinkSync(tempInstallerPath)
              } catch (cleanErr: any) {
                logger.log('WARN', 'OllamaApp', `Failed unlinking temp installer after exec: ${cleanErr.message}`)
              }
            })
            resolve({ success: true, message: 'Installer launched.' })
          })
        })
      }

      const request = https.get(downloadUrl, handleResponse)
      request.on('error', (err) => cleanupAndFail(err.message))
    })
  }

  pullModel(modelName: string, onProgress?: (progress: { status: string; completed?: number; total?: number }) => void) {
    return ollamaHttpClient.pullModel(modelName, undefined, onProgress)
  }

  cancelPullModel() {
    ollamaHttpClient.cancelPull()
    return { success: true }
  }

  deleteModel(modelName: string) {
    return ollamaHttpClient.deleteModel(modelName)
  }

  generateStream(
    model: string,
    prompt: string,
    onChunk: (chunk: string) => void,
    onDone: () => void,
    customOptions?: { num_ctx?: number; temperature?: number; top_p?: number; repeat_penalty?: number; num_thread?: number }
  ) {
    return ollamaHttpClient.generateStream(model, prompt, onChunk, onDone, customOptions)
  }

  async getInstalledModels(host?: string): Promise<string[]> {
    try {
      const status = await checkOllamaStatus(host || 'http://127.0.0.1:11434')
      return status.models || []
    } catch {
      return []
    }
  }

  /** Model name -> Ollama-reported capabilities (e.g. ["completion", "tools"]). */
  getModelCapabilities(host?: string): Promise<Record<string, string[]>> {
    return ollamaHttpClient.getModelCapabilities(host)
  }

  /** Warms a model into memory ahead of the first turn. Never throws — see preloadModel. */
  preloadModel(modelName: string, host?: string): Promise<{ success: boolean; error?: string }> {
    return ollamaHttpClient.preloadModel(modelName, host)
  }

  cancelStream() {
    ollamaHttpClient.cancelStream()
  }

  getRunningModels(host?: string) {
    return ollamaHttpClient.getRunningModels(host)
  }

  unloadModel(modelName: string, host?: string) {
    return ollamaHttpClient.unloadModel(modelName, host)
  }

  benchmarkModel(modelName: string) {
    return ollamaHttpClient.benchmarkModel(modelName)
  }
}

export const ollamaAppService = new OllamaAppService()
