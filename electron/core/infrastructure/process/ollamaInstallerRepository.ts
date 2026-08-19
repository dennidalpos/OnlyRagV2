import { app } from 'electron'
import path from 'node:path'
import https from 'node:https'
import http from 'node:http'
import fs from 'node:fs'
import { spawn, exec } from 'node:child_process'
import { logger } from '../../../diagnostics'

export class OllamaInstallerRepository {
  installOrLaunch(): Promise<{ success: boolean; message?: string; error?: string }> {
    logger.log('INFO', 'OllamaInstallerRepo', 'User requested Ollama launch or installation...')

    const localAppData = process.env.LOCALAPPDATA || ''
    const possibleOllamaExes = [
      path.join(localAppData, 'Programs/Ollama/ollama app.exe'),
      path.join(localAppData, 'Programs/Ollama/ollama.exe'),
      'ollama.exe',
    ]

    for (const exePath of possibleOllamaExes) {
      if (exePath === 'ollama.exe' || fs.existsSync(exePath)) {
        try {
          logger.log('INFO', 'OllamaInstallerRepo', `Attempting to launch Ollama: ${exePath}`)
          const p = spawn(exePath, ['serve'], { detached: true, stdio: 'ignore' })
          p.unref()
          return Promise.resolve({ success: true, message: 'Ollama launched.' })
        } catch (err: any) {
          logger.log('WARN', 'OllamaInstallerRepo', `Failed launching ${exePath}: ${err.message}`)
        }
      }
    }

    const tempInstallerPath = path.join(app.getPath('temp'), 'OllamaSetup.exe')
    const downloadUrl = 'https://ollama.com/download/OllamaSetup.exe'
    logger.log('INFO', 'OllamaInstallerRepo', `Downloading Ollama installer from ${downloadUrl}...`)

    return new Promise((resolve) => {
      const file = fs.createWriteStream(tempInstallerPath)

      const cleanupAndFail = (errMsg: string) => {
        try {
          if (fs.existsSync(tempInstallerPath)) fs.unlinkSync(tempInstallerPath)
        } catch (unlinkErr: any) {
          logger.log('WARN', 'OllamaInstallerRepo', `Failed unlinking temp installer on error: ${unlinkErr.message}`)
        }
        logger.log('ERROR', 'OllamaInstallerRepo', `Installer download failed: ${errMsg}`)
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
            logger.log('INFO', 'OllamaInstallerRepo', 'OllamaSetup.exe downloaded. Launching installer...')
            exec(`"${tempInstallerPath}"`, (err) => {
              if (err) logger.log('WARN', 'OllamaInstallerRepo', `Installer closed: ${err.message}`)
              try {
                if (fs.existsSync(tempInstallerPath)) fs.unlinkSync(tempInstallerPath)
              } catch (cleanErr: any) {
                logger.log('WARN', 'OllamaInstallerRepo', `Failed unlinking temp installer after exec: ${cleanErr.message}`)
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
}

export const ollamaInstallerRepository = new OllamaInstallerRepository()
