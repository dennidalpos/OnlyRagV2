import { app } from 'electron'
import path from 'node:path'
import http from 'node:http'
import fs from 'node:fs'
import { spawn, ChildProcess } from 'node:child_process'
import { logger } from '../../../diagnostics'
import type { SidecarState } from '../../domain/sidecar/sidecarTypes'

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 })

let sidecarProcess: ChildProcess | null = null

export class SidecarProcessManager {
  private state: {
    status: 'online' | 'offline' | 'checking'
    engine?: string
    version?: string
    endpoint?: string
    documentsCount?: number
    chunksCount?: number
    error?: string
  } = {
    status: 'checking',
  }

  getSidecarState() {
    return this.state
  }

  checkSidecarHealth(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get('http://127.0.0.1:8000/health', { agent: httpAgent, timeout: 3000 }, (res) => {
        let raw = ''
        res.on('data', (chunk) => {
          raw += chunk
        })
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const data = JSON.parse(raw)
              this.state = {
                status: 'online',
                engine: data.engine || 'FastAPI Python Sidecar + LanceDB OCR Engine',
                version: data.version || '2.2.0',
                endpoint: 'http://127.0.0.1:8000',
                documentsCount: data.documents_count || 0,
                chunksCount: data.chunks_count || 0,
              }
              resolve(true)
            } catch (err: any) {
              logger.log('WARN', 'Sidecar', `Non-standard JSON response from /health: ${err.message}`)
              this.state = { status: 'online', engine: 'FastAPI + LanceDB', endpoint: 'http://127.0.0.1:8000' }
              resolve(true)
            }
          } else {
            this.state = { status: 'offline', error: `HTTP ${res.statusCode}` }
            resolve(false)
          }
        })
      })
      req.on('error', (err) => {
        if (this.state.status !== 'online') {
          this.state = { status: 'offline', error: this.state.error || err.message }
        }
        resolve(false)
      })
      req.setTimeout(3000, () => {
        req.destroy()
        resolve(false)
      })
    })
  }

  private getPythonExecutable(): string {
    const possiblePaths = [
      path.join(process.cwd(), '.venv', 'Scripts', 'python.exe'),
      path.join(process.cwd(), 'venv', 'Scripts', 'python.exe'),
      path.join(__dirname, '..', '..', '..', '..', 'venv', 'Scripts', 'python.exe'),
      path.join(__dirname, '..', '..', '..', '..', '.venv', 'Scripts', 'python.exe'),
      path.join(app.getAppPath(), 'venv', 'Scripts', 'python.exe'),
      path.join(app.getAppPath(), '.venv', 'Scripts', 'python.exe'),
      path.join(process.resourcesPath, 'venv', 'Scripts', 'python.exe'),
      path.join(process.resourcesPath, '.venv', 'Scripts', 'python.exe'),
      path.join(process.cwd(), '.venv', 'bin', 'python'),
      path.join(process.cwd(), 'venv', 'bin', 'python'),
    ]
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) return p
    }
    return 'python'
  }

  private execAsync(cmd: string, args: string[], options?: { timeout?: number }): Promise<{ status: number | null; stderr: string }> {
    return new Promise((resolve) => {
      const p = spawn(cmd, args, { ...options })
      let stderr = ''
      p.stderr?.on('data', (data) => {
        stderr += data.toString()
      })
      p.on('close', (code) => resolve({ status: code, stderr }))
      p.on('error', (err) => resolve({ status: -1, stderr: err.message }))
    })
  }

  private async ensureSidecarDependencies(requirementsPath: string): Promise<string> {
    const initialPython = this.getPythonExecutable()
    const check = await this.execAsync(initialPython, ['-c', 'import fastapi, uvicorn, lancedb, pymupdf'])
    if (check.status === 0) {
      logger.log('INFO', 'Sidecar', `Python environment verified with required dependencies: ${initialPython}`)
      return initialPython
    }

    logger.log('WARN', 'Sidecar', `Dependencies missing in ${initialPython}. Initializing virtual environment setup...`)
    const venvDir = app.isPackaged
      ? path.join(app.getPath('userData'), 'python_venv')
      : path.join(__dirname, '..', '..', '..', '..', '.venv')
    const venvPython = path.join(venvDir, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')

    if (!fs.existsSync(venvPython)) {
      logger.log('INFO', 'Sidecar', `Creating virtual environment at ${venvDir}...`)
      await this.execAsync('python', ['-m', 'venv', venvDir])
    }

    if (fs.existsSync(venvPython) && fs.existsSync(requirementsPath)) {
      logger.log('INFO', 'Sidecar', `Installing dependencies from ${requirementsPath} into ${venvPython}...`)
      const install = await this.execAsync(venvPython, ['-m', 'pip', 'install', '-r', requirementsPath], { timeout: 120000 })
      if (install.status === 0) {
        logger.log('INFO', 'Sidecar', `Successfully installed sidecar dependencies.`)
        return venvPython
      } else {
        logger.log('ERROR', 'Sidecar', `Failed installing dependencies into ${venvPython}: ${install.stderr}`)
      }
    }

    return initialPython
  }

  private async waitForSidecarHealth(maxAttempts = 15, intervalMs = 1000): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
      const isOnline = await this.checkSidecarHealth()
      if (isOnline) {
        logger.log('INFO', 'Sidecar', `Sidecar health check succeeded after attempt ${i + 1}.`)
        return true
      }
      if (!sidecarProcess && i > 0) {
        logger.log('WARN', 'Sidecar', 'Sidecar process terminated during startup health check.')
        return false
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
    logger.log('WARN', 'Sidecar', `Sidecar health check timed out after ${maxAttempts} seconds.`)
    return false
  }

  async startPythonSidecar(): Promise<boolean> {
    if (await this.checkSidecarHealth()) {
      logger.log('INFO', 'Sidecar', 'Python sidecar is already running on port 8000.')
      return true
    }

    this.stopPythonSidecar()

    const dataDir = path.join(app.getPath('userData'), 'data')
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }

    const devSidecarDir = app.isPackaged
      ? path.join(process.resourcesPath, 'sidecar')
      : path.join(__dirname, '..', '..', '..', '..', 'sidecar')
    const parentSidecarDir = path.dirname(devSidecarDir)

    const envVars = {
      ...process.env,
      ONLYRAG_DATA_DIR: dataDir,
      PYTHONUNBUFFERED: '1',
      PYTHONPATH: `${devSidecarDir}${path.delimiter}${parentSidecarDir}${process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : ''}`,
    }

    const isPackaged = app.isPackaged
    let exePath = ''

    if (isPackaged) {
      // electron-builder's extraResources entry for sidecar_dist/sidecar has "to": "sidecar",
      // so the compiled PyInstaller binary lands at resources/sidecar/sidecar.exe -- "sidecar_dist"
      // is only the local build-time staging directory name (see build_package.ps1), it never
      // exists inside the packaged app itself.
      exePath = path.join(process.resourcesPath, 'sidecar', 'sidecar.exe')
    }

    if (isPackaged && fs.existsSync(exePath)) {
      logger.log('INFO', 'Sidecar', `Launching packaged PyInstaller sidecar binary: ${exePath}`)
      sidecarProcess = spawn(exePath, [], {
        env: envVars,
        cwd: path.dirname(exePath),
        windowsHide: true,
      })
    } else {
      const mainPyPath = path.join(devSidecarDir, 'main.py')
      const requirementsPath = path.join(devSidecarDir, 'requirements.txt')

      if (!fs.existsSync(mainPyPath)) {
        logger.log('ERROR', 'Sidecar', `Python sidecar main.py not found at: ${mainPyPath}`)
        this.state = { status: 'offline', error: 'sidecar/main.py missing' }
        return false
      }

      const pythonPath = await this.ensureSidecarDependencies(requirementsPath)
      logger.log('INFO', 'Sidecar', `Launching Python sidecar script via: ${pythonPath} ${mainPyPath}`)

      sidecarProcess = spawn(pythonPath, ['-u', mainPyPath], {
        env: envVars,
        cwd: devSidecarDir,
        windowsHide: true,
      })
    }

    if (!sidecarProcess) {
      this.state = { status: 'offline', error: 'Failed spawning sidecar process' }
      return false
    }

    sidecarProcess.stdout?.on('data', (data) => {
      const msg = data.toString().trim()
      if (
        msg.includes('GET /health HTTP/1.1" 200') ||
        msg.includes('GET /documents HTTP/1.1" 200') ||
        msg.includes('GET /docs HTTP/1.1" 200')
      ) {
        return // Suppress redundant periodic polling stdout access logs
      }
      logger.log('INFO', 'SidecarProcess', msg)
    })

    sidecarProcess.stderr?.on('data', (data) => {
      const msg = data.toString().trim()
      if (msg.includes('GET /health HTTP/1.1" 200') || msg.includes('GET /documents HTTP/1.1" 200')) {
        return
      }
      logger.log('WARN', 'SidecarProcess', msg)
    })

    sidecarProcess.on('close', (code) => {
      logger.log('WARN', 'Sidecar', `Python sidecar process exited with code ${code}`)
      sidecarProcess = null
      if (this.state.status !== 'online') {
        this.state = { status: 'offline', error: `Process exited with code ${code}` }
      }
    })

    sidecarProcess.on('error', (err) => {
      logger.log('ERROR', 'Sidecar', `Python sidecar process failed to start: ${err.message}`)
      sidecarProcess = null
      this.state = { status: 'offline', error: err.message }
    })

    return await this.waitForSidecarHealth()
  }

  stopPythonSidecar() {
    if (sidecarProcess) {
      logger.log('INFO', 'Sidecar', 'Stopping Python sidecar process...')
      try {
        if (process.platform === 'win32' && sidecarProcess.pid) {
          spawn('taskkill', ['/pid', sidecarProcess.pid.toString(), '/f', '/t'])
        } else {
          sidecarProcess.kill('SIGKILL')
        }
      } catch (err: any) {
        logger.log('WARN', 'Sidecar', `Error stopping sidecar process: ${err.message}`)
      }
      sidecarProcess = null
      this.state = { status: 'offline' }
    }
  }

  async restartPythonSidecar(): Promise<boolean> {
    logger.log('INFO', 'Sidecar', 'Restarting Python sidecar...')
    this.stopPythonSidecar()
    await new Promise((resolve) => setTimeout(resolve, 1000))
    return await this.startPythonSidecar()
  }
}

export const sidecarProcessManager = new SidecarProcessManager()
