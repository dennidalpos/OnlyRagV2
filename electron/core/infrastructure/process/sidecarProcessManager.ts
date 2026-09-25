import { app } from 'electron'
import path from 'node:path'
import http from 'node:http'
import fs from 'node:fs'
import { randomBytes } from 'node:crypto'
import { spawn, ChildProcess } from 'node:child_process'
import { logger } from '../logging/logger'
import { parseSidecarHealthResponse } from '../../../../shared/domain/sidecarHealth'
import { normalizeOllamaHost } from '../../../../shared/domain/ollamaHost'
import { appSettingsRepository } from '../filesystem/appSettingsRepository'
import { sidecarHttpClient } from '../http/sidecarHttpClient'
import { isProcessOrDescendant, matchesSidecarOwnership, parseListeningPidFromNetstat, type SidecarOwnershipMarker } from './orphanPortReclaim'
import { errorMessage } from '../../../../shared/domain/errors/errorMessage'

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 })

// In development the main process runs bundled as dist-electron/main.js, one level below the repository root, so __dirname is <root>/dist-electron no matter where this module's source lives.
const DEV_PROJECT_ROOT = path.join(__dirname, '..')

const SIDECAR_PORT = 8000
const SIDECAR_BASE_URL = `http://127.0.0.1:${SIDECAR_PORT}`
const OWNERSHIP_FILE_NAME = 'sidecar-ownership.json'

/** How long to wait for a terminated orphan to actually release the port before giving up. */
const ORPHAN_PORT_RELEASE_ATTEMPTS = 5
const ORPHAN_PORT_RELEASE_INTERVAL_MS = 400

let sidecarProcess: ChildProcess | null = null

export interface LegacySidecarDataMigration {
  moved: string[]
  conflicts: string[]
}

/** Uvicorn writes routine lifecycle and access records to stderr; classify by content instead of stream. */
export function classifySidecarStderr(message: string): 'INFO' | 'WARN' | 'ERROR' {
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.some((line) => /^(ERROR|CRITICAL):/i.test(line)) || /Traceback \(most recent call last\):/i.test(message)) {
    return 'ERROR'
  }
  if (lines.some((line) => /^(WARNING|WARN):/i.test(line))) return 'WARN'
  if (lines.length > 0 && lines.every((line) => /^INFO:/i.test(line))) return 'INFO'
  return 'WARN'
}

/**
 * Older Electron builds passed `<userData>/data` as ONLYRAG_DATA_DIR while Python
 * appended its own `data` segment. Move that nested content back to the canonical
 * directory without overwriting any entry already present there.
 */
export function migrateLegacyNestedSidecarData(userDataDir: string): LegacySidecarDataMigration {
  const canonicalDataDir = path.join(userDataDir, 'data')
  const legacyNestedDataDir = path.join(canonicalDataDir, 'data')
  const result: LegacySidecarDataMigration = { moved: [], conflicts: [] }

  if (!fs.existsSync(legacyNestedDataDir)) return result

  fs.mkdirSync(canonicalDataDir, { recursive: true })
  for (const entry of fs.readdirSync(legacyNestedDataDir)) {
    const source = path.join(legacyNestedDataDir, entry)
    const destination = path.join(canonicalDataDir, entry)
    if (fs.existsSync(destination)) {
      result.conflicts.push(entry)
      continue
    }
    fs.renameSync(source, destination)
    result.moved.push(entry)
  }

  if (fs.readdirSync(legacyNestedDataDir).length === 0) {
    fs.rmdirSync(legacyNestedDataDir)
  }
  return result
}

export class SidecarProcessManager {
  private launchedOllamaHost: string | null = null
  private state: {
    status: 'online' | 'offline' | 'checking'
    engine?: string
    version?: string
    endpoint?: string
    documentsCount?: number
    chunksCount?: number
    error?: string
    ocr?: {
      provider: string
      host_has_gpu: boolean
    }
  } = {
    status: 'checking',
  }

  getSidecarState() {
    return this.state
  }

  checkSidecarHealth(timeoutMs = 3000): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false
      const finishOffline = (error: string) => {
        if (settled) return
        settled = true
        this.state = { status: 'offline', error }
        resolve(false)
      }
      const req = http.get(`${SIDECAR_BASE_URL}/health`, { agent: httpAgent, timeout: timeoutMs }, (res) => {
        let raw = ''
        res.on('data', (chunk) => {
          raw += chunk
        })
        res.on('end', () => {
          if (res.statusCode !== 200) {
            finishOffline(`HTTP ${res.statusCode || 'unknown'}`)
            return
          }
          try {
            const data = parseSidecarHealthResponse(JSON.parse(raw))
            if (!data) {
              finishOffline('Malformed /health response')
              return
            }
            if (settled) return
            settled = true
            this.state = {
              status: 'online',
              engine: data.engine,
              version: data.version,
              endpoint: SIDECAR_BASE_URL,
              documentsCount: data.documents_count,
              chunksCount: data.chunks_count,
              ocr: data.ocr as { provider: string; host_has_gpu: boolean },
            }
            resolve(true)
          } catch (err: unknown) {
            logger.log('WARN', 'Sidecar', `Invalid JSON response from /health: ${errorMessage(err)}`)
            finishOffline('Malformed /health response')
          }
        })
      })
      req.on('error', (err) => {
        finishOffline(err.message)
      })
      req.setTimeout(timeoutMs, () => {
        finishOffline(`Health probe timed out after ${timeoutMs}ms`)
        req.destroy()
      })
    })
  }

  private getPythonExecutable(): string {
    const possiblePaths = [
      path.join(process.cwd(), '.venv', 'Scripts', 'python.exe'),
      path.join(process.cwd(), 'venv', 'Scripts', 'python.exe'),
      path.join(DEV_PROJECT_ROOT, 'venv', 'Scripts', 'python.exe'),
      path.join(DEV_PROJECT_ROOT, '.venv', 'Scripts', 'python.exe'),
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
    const check = await this.execAsync(initialPython, ['-c', 'import fastapi, uvicorn, lancedb, pymupdf, cv2, rapidocr_onnxruntime'])
    if (check.status === 0) {
      logger.log('INFO', 'Sidecar', `Python environment verified with required dependencies: ${initialPython}`)
      return initialPython
    }

    logger.log('WARN', 'Sidecar', `Dependencies missing in ${initialPython}. Initializing virtual environment setup...`)
    const venvDir = app.isPackaged ? path.join(app.getPath('userData'), 'python_venv') : path.join(DEV_PROJECT_ROOT, '.venv')
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

  /** Runs a command purely to read its stdout. */
  private readCommandOutput(cmd: string, args: string[], timeoutMs = 5000): Promise<string> {
    return new Promise((resolve) => {
      let stdout = ''
      let settled = false
      const finish = (value: string) => {
        if (settled) return
        settled = true
        resolve(value)
      }

      try {
        const proc = spawn(cmd, args, { windowsHide: true })
        const timer = setTimeout(() => {
          proc.kill()
          finish('')
        }, timeoutMs)

        proc.stdout?.on('data', (data) => {
          stdout += data.toString()
        })
        proc.on('close', () => {
          clearTimeout(timer)
          finish(stdout)
        })
        proc.on('error', () => {
          clearTimeout(timer)
          finish('')
        })
      } catch {
        finish('')
      }
    })
  }

  /** Terminates a sidecar left listening on the port by a previous session, so this run can own the process it talks to. */
  private async reclaimOrphanSidecarPort(): Promise<boolean> {
    if (process.platform !== 'win32') {
      logger.log('WARN', 'Sidecar', `Port ${SIDECAR_PORT} is held by a sidecar this session did not start; automatic reclaim is implemented for Windows only.`)
      return false
    }

    const netstat = await this.readCommandOutput('netstat', ['-ano', '-p', 'tcp'])
    const pid = parseListeningPidFromNetstat(netstat, SIDECAR_PORT)
    let marker: SidecarOwnershipMarker | null = null
    try {
      marker = JSON.parse(await fs.promises.readFile(path.join(app.getPath('userData'), OWNERSHIP_FILE_NAME), 'utf-8')) as SidecarOwnershipMarker
    } catch {
      /* Missing marker is not ownership proof. */
    }
    const current = pid === null ? null : await this.readProcessIdentity(pid)
    if (!matchesSidecarOwnership(marker, current) || pid === process.pid) {
      this.state = { status: 'offline', error: `Port ${SIDECAR_PORT} is occupied by an unowned process.` }
      logger.log('ERROR', 'Sidecar', this.state.error || 'Unowned sidecar port')
      return false
    }

    logger.log('INFO', 'Sidecar', `Reclaiming owned sidecar on port ${SIDECAR_PORT} (PID ${pid}).`)
    await this.readCommandOutput('taskkill', ['/pid', String(pid), '/f', '/t'])

    // The port is not free the instant taskkill returns, and spawning into a still-bound port
    // is exactly the failure this is meant to prevent.
    for (let attempt = 0; attempt < ORPHAN_PORT_RELEASE_ATTEMPTS; attempt++) {
      if (!(await this.checkSidecarHealth())) return true
      await new Promise((resolve) => setTimeout(resolve, ORPHAN_PORT_RELEASE_INTERVAL_MS))
    }

    logger.log('WARN', 'Sidecar', `Port ${SIDECAR_PORT} still answering after terminating PID ${pid}.`)
    return false
  }

  private async readProcessIdentity(pid: number): Promise<SidecarOwnershipMarker | null> {
    if (!Number.isSafeInteger(pid) || pid <= 0) return null
    const command = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($p) { [pscustomobject]@{ pid = [int]$p.ProcessId; executablePath = $p.ExecutablePath; startedAt = $p.CreationDate.ToString('o') } | ConvertTo-Json -Compress }`
    try {
      const raw = await this.readCommandOutput('powershell', ['-NoProfile', '-NonInteractive', '-Command', command])
      const identity = JSON.parse(raw) as SidecarOwnershipMarker
      return typeof identity.executablePath === 'string' && typeof identity.startedAt === 'string' ? identity : null
    } catch {
      return null
    }
  }

  private async readParentPid(pid: number): Promise<number | null> {
    if (process.platform !== 'win32' || !Number.isSafeInteger(pid) || pid <= 0) return null
    const raw = await this.readCommandOutput('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').ParentProcessId`,
    ])
    const parent = Number.parseInt(raw.trim(), 10)
    return Number.isSafeInteger(parent) && parent > 0 ? parent : null
  }

  async startPythonSidecar(): Promise<boolean> {
    if (await this.checkSidecarHealth()) {
      // Ours, started earlier in this same session: nothing to do.
      if (sidecarProcess) {
        logger.log('INFO', 'Sidecar', `Python sidecar is already running on port ${SIDECAR_PORT}.`)
        return true
      }
      // Not ours. Adopting it would leave this session unable to ever stop the sidecar it
      // depends on, and would keep serving the previous build after an update.
      const reclaimed = await this.reclaimOrphanSidecarPort()
      if (!reclaimed) {
        return false
      }
    }

    if (process.platform === 'win32') {
      const listener = parseListeningPidFromNetstat(await this.readCommandOutput('netstat', ['-ano', '-p', 'tcp']), SIDECAR_PORT)
      if (listener !== null) {
        this.state = { status: 'offline', error: `Port ${SIDECAR_PORT} is occupied by process ${listener}; Sidecar was not started.` }
        logger.log('ERROR', 'Sidecar', this.state.error || 'Port conflict')
        return false
      }
    }

    this.stopPythonSidecar()

    const userDataDir = app.getPath('userData')
    const migration = migrateLegacyNestedSidecarData(userDataDir)
    if (migration.moved.length > 0) {
      logger.log('INFO', 'Sidecar', `Migrated legacy nested data entries: ${migration.moved.join(', ')}`)
    }
    if (migration.conflicts.length > 0) {
      logger.log('WARN', 'Sidecar', `Legacy nested data entries left in place because canonical entries already exist: ${migration.conflicts.join(', ')}`)
    }

    const dataDir = path.join(userDataDir, 'data')
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }

    const devSidecarDir = app.isPackaged ? path.join(process.resourcesPath, 'sidecar') : path.join(DEV_PROJECT_ROOT, 'sidecar')
    const parentSidecarDir = path.dirname(devSidecarDir)

    // The sidecar calls Ollama itself (embeddings, vision OCR, translation), so it must use the configured host.
    const ollamaHost = normalizeOllamaHost((await appSettingsRepository.loadSettings())?.ollamaHost)
    this.launchedOllamaHost = ollamaHost
    // Fresh per launch: only this process learns it, so no other local caller can drive the API.
    const sidecarToken = randomBytes(32).toString('hex')
    sidecarHttpClient.setAuthToken(sidecarToken)
    const envVars = {
      ...process.env,
      ONLYRAG_DATA_DIR: userDataDir,
      ONLYRAG_SIDECAR_TOKEN: sidecarToken,
      OLLAMA_BASE_URL: ollamaHost,
      PYTHONUNBUFFERED: '1',
      PYTHONPATH: `${devSidecarDir}${path.delimiter}${parentSidecarDir}${process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : ''}`,
    }

    const isPackaged = app.isPackaged
    let exePath = ''

    if (isPackaged) {
      // electron-builder's extraResources entry for sidecar_dist/sidecar has "to": "sidecar", so the compiled PyInstaller binary lands at resources/sidecar/sidecar.exe -- "sidecar_dist" is only the local build-time staging directory name (see build_package.ps1), it ne
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

    this.attachSidecarProcessLogs()
    if (!(await this.waitForSidecarHealth())) return false
    const childPid = sidecarProcess?.pid
    const listenerPid =
      process.platform === 'win32' ? parseListeningPidFromNetstat(await this.readCommandOutput('netstat', ['-ano', '-p', 'tcp']), SIDECAR_PORT) : childPid
    if (!childPid || !listenerPid || !(await isProcessOrDescendant(listenerPid, childPid, (pid) => this.readParentPid(pid)))) {
      this.stopPythonSidecar()
      this.state = { status: 'offline', error: 'Sidecar port was taken by another process during startup.' }
      return false
    }
    if (process.platform === 'win32') {
      // The listener, not the spawned launcher: orphan reclaim compares this marker with the PID netstat reports.
      const identity = await this.readProcessIdentity(listenerPid)
      if (!identity) {
        this.stopPythonSidecar()
        this.state = { status: 'offline', error: 'Could not verify Sidecar process ownership.' }
        return false
      }
      await fs.promises.writeFile(path.join(app.getPath('userData'), OWNERSHIP_FILE_NAME), JSON.stringify(identity), 'utf-8')
    }
    return true
  }

  private writeSidecarLog(level: 'INFO' | 'WARN' | 'ERROR', msg: string) {
    try {
      const logDir = path.dirname(logger.getLogFilePath())
      const logPath = path.join(logDir, 'sidecar.log')
      if (fs.existsSync(logPath)) {
        const stats = fs.statSync(logPath)
        if (stats.size > 10 * 1024 * 1024) {
          const log1 = path.join(logDir, 'sidecar.1.log')
          if (fs.existsSync(log1)) fs.unlinkSync(log1)
          fs.renameSync(logPath, log1)
        }
      }
      const timestamp = new Date().toISOString()
      fs.appendFileSync(logPath, `[${timestamp}] [${level}] ${msg}\n`, 'utf-8')
    } catch {}
  }

  private attachSidecarProcessLogs() {
    if (!sidecarProcess) return

    sidecarProcess.stdout?.on('data', (data) => {
      const msg = data.toString().trim()
      this.writeSidecarLog('INFO', msg)
      if (msg.includes('GET /health HTTP/1.1" 200') || msg.includes('GET /documents HTTP/1.1" 200') || msg.includes('GET /docs HTTP/1.1" 200')) {
        return // Suppress redundant periodic polling stdout access logs in main diagnostics logger
      }
      logger.log('INFO', 'SidecarProcess', msg)
    })

    sidecarProcess.stderr?.on('data', (data) => {
      const msg = data.toString().trim()
      const level = classifySidecarStderr(msg)
      this.writeSidecarLog(level, msg)
      if (msg.includes('GET /health HTTP/1.1" 200') || msg.includes('GET /documents HTTP/1.1" 200')) {
        return
      }
      logger.log(level, 'SidecarProcess', msg)
    })

    sidecarProcess.on('close', (code) => {
      this.writeSidecarLog('WARN', `Python sidecar process exited with code ${code}`)
      logger.log('WARN', 'Sidecar', `Python sidecar process exited with code ${code}`)
      this.markProcessExited(code)
    })

    sidecarProcess.on('error', (err) => {
      this.writeSidecarLog('ERROR', `Python sidecar process failed to start: ${err.message}`)
      logger.log('ERROR', 'Sidecar', `Python sidecar process failed to start: ${err.message}`)
      sidecarProcess = null
      this.state = { status: 'offline', error: err.message }
    })
  }

  private markProcessExited(code: number | null) {
    sidecarProcess = null
    this.state = { status: 'offline', error: `Process exited with code ${code}` }
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
      } catch (err: unknown) {
        logger.log('WARN', 'Sidecar', `Error stopping sidecar process: ${errorMessage(err)}`)
      }
      sidecarProcess = null
      this.state = { status: 'offline' }
    }
  }

  /** Ollama host the running sidecar was started with; null when this session has not launched one. */
  getLaunchedOllamaHost(): string | null {
    return sidecarProcess ? this.launchedOllamaHost : null
  }

  async restartPythonSidecar(): Promise<boolean> {
    logger.log('INFO', 'Sidecar', 'Restarting Python sidecar...')
    this.stopPythonSidecar()
    await new Promise((resolve) => setTimeout(resolve, 1000))
    return await this.startPythonSidecar()
  }
}

export const sidecarProcessManager = new SidecarProcessManager()
