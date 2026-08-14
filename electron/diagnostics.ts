import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { exec } from 'node:child_process'
import { app } from 'electron'

export interface SystemRequirementsCheck {
  isOsSupported: boolean
  hasMinRam: boolean
  hasRecRam: boolean
  isOllamaReady: boolean
  isGpuAccelerated: boolean
  isSidecarReady: boolean
  overallStatus: 'optimal' | 'warning' | 'incompatible'
}

export interface DiagnosticsData {
  sidecar: {
    status: 'online' | 'offline' | 'checking'
    engine?: string
    version?: string
    endpoint?: string
    documentsCount?: number
    chunksCount?: number
    error?: string
  }
  ollama: {
    status: 'online' | 'offline' | 'checking'
    url: string
    modelsCount: number
    models: string[]
    error?: string
  }
  gpu: {
    hasNvidiaGpu: boolean
    gpuName?: string
    vramTotalMB?: number
    vramUsedMB?: number
    cudaVersion?: string
    driverVersion?: string
    error?: string
  }
  memory: {
    totalRAMGB: number
    freeRAMGB: number
    usedRAMGB: number
    ramUsagePercent: number
  }
  system: {
    platform: string
    arch: string
    cpusCount: number
    cpuModel: string
  }
  requirements: SystemRequirementsCheck
  timestamp: string
}

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  category: string
}

class SystemDiagnosticsLogger {
  private logFilePath: string
  private logsBuffer: LogEntry[] = []
  private maxBufferLength = 1000
  private maxLogFileSizeBytes = 5 * 1024 * 1024 // 5 MB max per log file

  constructor() {
    const baseDir = (app && typeof app.getPath === 'function') ? app.getPath('userData') : process.cwd()
    const logDir = path.join(baseDir, 'logs')
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true })
    }
    this.logFilePath = path.join(logDir, 'app.log')
    this.rotateLogsIfNeeded()
    this.log('INFO', 'Logger', `System Diagnostics Logger initialized. Log path: ${this.logFilePath}`)
  }

  public getLogFilePath(): string {
    return this.logFilePath
  }

  private rotateLogsIfNeeded(): void {
    try {
      if (!fs.existsSync(this.logFilePath)) return
      const stats = fs.statSync(this.logFilePath)
      if (stats.size >= this.maxLogFileSizeBytes) {
        const logDir = path.dirname(this.logFilePath)
        const log1 = path.join(logDir, 'app.1.log')
        const log2 = path.join(logDir, 'app.2.log')

        try {
          if (fs.existsSync(log1)) {
            if (fs.existsSync(log2)) {
              fs.unlinkSync(log2)
            }
            fs.renameSync(log1, log2)
          }
          fs.renameSync(this.logFilePath, log1)
          fs.writeFileSync(this.logFilePath, '', 'utf-8')
        } catch (renameErr) {
          // Fallback on Windows if file handle is locked: truncate in place
          fs.writeFileSync(this.logFilePath, '', 'utf-8')
        }
      }
    } catch (err) {
      console.error('Error during log file rotation:', err)
    }
  }

  public log(level: LogLevel, category: string, message: string): LogEntry {
    const timestamp = new Date().toISOString()
    const entry: LogEntry = { timestamp, level, message, category }
    this.logsBuffer.push(entry)
    if (this.logsBuffer.length > this.maxBufferLength) {
      this.logsBuffer.shift()
    }

    const logFormatted = `[${timestamp}] [${level}] [${category}]: ${message}\n`
    try {
      this.rotateLogsIfNeeded()
      fs.appendFileSync(this.logFilePath, logFormatted, 'utf-8')
    } catch (err) {
      console.error('Failed writing log to file:', err)
    }

    console.log(logFormatted.trim())
    return entry
  }

  public getLogs(): LogEntry[] {
    return [...this.logsBuffer]
  }

  public clearLogs(): void {
    this.logsBuffer = []
    try {
      if (fs.existsSync(this.logFilePath)) {
        fs.writeFileSync(this.logFilePath, '', { encoding: 'utf-8' })
      }
      const cwdLog = path.join(process.cwd(), 'logs', 'app.log')
      if (cwdLog !== this.logFilePath && fs.existsSync(cwdLog)) {
        fs.writeFileSync(cwdLog, '', { encoding: 'utf-8' })
      }
    } catch (err) {
      console.error('Failed clearing physical log file:', err)
    }
  }
}

export const logger = new SystemDiagnosticsLogger()

export function generateDiagnosticsReport(diagnostics: DiagnosticsData, recentLogs: LogEntry[] = []): string {
  return `# OnlyRag V2 - System Diagnostics & Health Report
Generated at: ${diagnostics.timestamp}

## System Overview
- **Platform:** ${diagnostics.system.platform} (${diagnostics.system.arch})
- **CPU:** ${diagnostics.system.cpuModel} (${diagnostics.system.cpusCount} cores)
- **Memory:** ${diagnostics.memory.usedRAMGB} GB / ${diagnostics.memory.totalRAMGB} GB (${diagnostics.memory.ramUsagePercent}% used)
- **Status:** ${diagnostics.requirements.overallStatus.toUpperCase()}

## Hardware & Acceleration
- **NVIDIA GPU:** ${diagnostics.gpu.hasNvidiaGpu ? `${diagnostics.gpu.gpuName} (CUDA ${diagnostics.gpu.cudaVersion || 'N/A'}, Driver ${diagnostics.gpu.driverVersion || 'N/A'})` : 'None / CPU Only'}
- **VRAM:** ${diagnostics.gpu.hasNvidiaGpu ? `${diagnostics.gpu.vramUsedMB || 0} / ${diagnostics.gpu.vramTotalMB || 0} MB` : 'N/A'}

## Core Engines
- **Ollama Core:** ${diagnostics.ollama.status.toUpperCase()} (${diagnostics.ollama.url})
  - Installed Models (${diagnostics.ollama.modelsCount}): ${diagnostics.ollama.models.join(', ') || 'None'}
- **Sidecar & LanceDB:** ${diagnostics.sidecar.status.toUpperCase()} ${diagnostics.sidecar.engine ? `(${diagnostics.sidecar.engine})` : ''}
  - Indexed Documents: ${diagnostics.sidecar.documentsCount ?? 0} docs (${diagnostics.sidecar.chunksCount ?? 0} vector chunks)

## Recent Diagnostic Logs (${recentLogs.length} entries)
\`\`\`text
${recentLogs.slice(-150).map((l) => `[${l.timestamp}] [${l.level}] [${l.category}]: ${l.message}`).join('\n')}
\`\`\`
`
}

export async function checkOllamaStatus(hostUrl = 'http://127.0.0.1:11434'): Promise<DiagnosticsData['ollama']> {
  const effectiveHost = hostUrl.replace('localhost', '127.0.0.1')
  return new Promise((resolve) => {
    const req = http.get(`${effectiveHost}/api/tags`, { timeout: 4500 }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const parsed = JSON.parse(data)
            const models = (parsed.models || []).map((m: any) => m.name || m.model)
            logger.log('INFO', 'Ollama', `Ollama online. Available models count: ${models.length}`)
            resolve({
              status: 'online',
              url: hostUrl,
              modelsCount: models.length,
              models,
            })
          } else {
            logger.log('WARN', 'Ollama', `Ollama returned HTTP status ${res.statusCode}`)
            resolve({
              status: 'offline',
              url: hostUrl,
              modelsCount: 0,
              models: [],
              error: `HTTP ${res.statusCode}`,
            })
          }
        } catch (e: any) {
          logger.log('ERROR', 'Ollama', `Failed parsing Ollama tags output: ${e.message}`)
          resolve({
            status: 'offline',
            url: hostUrl,
            modelsCount: 0,
            models: [],
            error: e.message,
          })
        }
      })
    })

    req.on('error', (err) => {
      logger.log('WARN', 'Ollama', `Ollama offline or unreachable at ${hostUrl}: ${err.message}`)
      resolve({
        status: 'offline',
        url: hostUrl,
        modelsCount: 0,
        models: [],
        error: err.message,
      })
    })

    req.on('timeout', () => {
      req.destroy()
      logger.log('WARN', 'Ollama', `Ollama check timed out at ${hostUrl}`)
      resolve({
        status: 'offline',
        url: hostUrl,
        modelsCount: 0,
        models: [],
        error: 'Connection timeout',
      })
    })
  })
}

let cachedGpuResult: DiagnosticsData['gpu'] | null = null
let cachedGpuTimestamp = 0
const GPU_CACHE_TTL_MS = 30000 // 30 seconds TTL cache for GPU process execution

export async function detectNvidiaGpu(): Promise<DiagnosticsData['gpu']> {
  const now = Date.now()
  if (cachedGpuResult && now - cachedGpuTimestamp < GPU_CACHE_TTL_MS) {
    return cachedGpuResult
  }

  return new Promise((resolve) => {
    exec('nvidia-smi', (error, stdout) => {
      if (error || !stdout.trim()) {
        logger.log('INFO', 'GPU', `nvidia-smi check failed or GPU not present: ${error?.message || 'No output'}`)
        const res: DiagnosticsData['gpu'] = {
          hasNvidiaGpu: false,
          error: 'No NVIDIA GPU detected or nvidia-smi unavailable',
        }
        cachedGpuResult = res
        cachedGpuTimestamp = now
        resolve(res)
        return
      }

      try {
        let cudaVersion = 'Unknown'
        const cudaMatch = stdout.match(/(?:CUDA Version|CUDA UMD Version):\s*([\d.]+)/i)
        if (cudaMatch) {
          cudaVersion = cudaMatch[1]
        }

        let driverVersion = 'Unknown'
        const driverMatch = stdout.match(/(?:Driver Version|KMD Version|NVIDIA-SMI):\s*([\d.]+)/i)
        if (driverMatch) {
          driverVersion = driverMatch[1]
        }

        const cmd = 'nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv,noheader,nounits'
        exec(cmd, (csvErr, csvStdout) => {
          let gpuName = 'NVIDIA GPU'
          let vramTotalMB = 0
          let vramUsedMB = 0

          if (!csvErr && csvStdout.trim()) {
            const parts = csvStdout.trim().split('\n')[0].split(',').map((s) => s.trim())
            gpuName = parts[0] || gpuName
            vramTotalMB = parseInt(parts[1], 10) || 0
            vramUsedMB = parseInt(parts[2], 10) || 0
          }

          logger.log('INFO', 'GPU', `Detected GPU: ${gpuName} | VRAM: ${vramUsedMB}/${vramTotalMB} MB | CUDA: ${cudaVersion}`)
          const res: DiagnosticsData['gpu'] = {
            hasNvidiaGpu: true,
            gpuName,
            vramTotalMB,
            vramUsedMB,
            driverVersion,
            cudaVersion,
          }
          cachedGpuResult = res
          cachedGpuTimestamp = now
          resolve(res)
        })
      } catch (e: any) {
        logger.log('ERROR', 'GPU', `Failed parsing nvidia-smi output: ${e.message}`)
        const res: DiagnosticsData['gpu'] = {
          hasNvidiaGpu: false,
          error: e.message,
        }
        cachedGpuResult = res
        cachedGpuTimestamp = now
        resolve(res)
      }
    })
  })
}

export function getMemoryInfo(): DiagnosticsData['memory'] {
  const total = os.totalmem()
  const free = os.freemem()
  const used = total - free
  const totalRAMGB = parseFloat((total / (1024 * 1024 * 1024)).toFixed(2))
  const freeRAMGB = parseFloat((free / (1024 * 1024 * 1024)).toFixed(2))
  const usedRAMGB = parseFloat((used / (1024 * 1024 * 1024)).toFixed(2))
  const ramUsagePercent = parseFloat(((used / total) * 100).toFixed(1))

  return {
    totalRAMGB,
    freeRAMGB,
    usedRAMGB,
    ramUsagePercent,
  }
}

export async function runFullDiagnostics(
  sidecarStatus: DiagnosticsData['sidecar'] = { status: 'offline', error: 'Not checked' },
  ollamaHost = 'http://127.0.0.1:11434'
): Promise<DiagnosticsData> {
  logger.log('INFO', 'Diagnostics', 'Running full system diagnostics scan...')
  const [ollama, gpu] = await Promise.all([
    checkOllamaStatus(ollamaHost),
    detectNvidiaGpu(),
  ])

  const memory = getMemoryInfo()
  const cpus = os.cpus()

  const isOsSupported = os.platform() === 'win32' && os.arch() === 'x64'
  const hasMinRam = memory.totalRAMGB >= 7.5
  const hasRecRam = memory.totalRAMGB >= 15.5
  const isOllamaReady = ollama.status === 'online'
  const isGpuAccelerated = gpu.hasNvidiaGpu
  const isSidecarReady = sidecarStatus.status === 'online'

  let overallStatus: SystemRequirementsCheck['overallStatus'] = 'optimal'
  if (!isOsSupported || !hasMinRam) {
    overallStatus = 'incompatible'
  } else if (!hasRecRam || !isOllamaReady || !isGpuAccelerated || !isSidecarReady) {
    overallStatus = 'warning'
  }

  const diagnosticsData: DiagnosticsData = {
    sidecar: sidecarStatus,
    ollama,
    gpu,
    memory,
    system: {
      platform: os.platform(),
      arch: os.arch(),
      cpusCount: cpus.length,
      cpuModel: cpus[0]?.model || 'Unknown CPU',
    },
    requirements: {
      isOsSupported,
      hasMinRam,
      hasRecRam,
      isOllamaReady,
      isGpuAccelerated,
      isSidecarReady,
      overallStatus,
    },
    timestamp: new Date().toISOString(),
  }

  logger.log('INFO', 'Diagnostics', `Full scan complete. Status: ${overallStatus}, Sidecar: ${sidecarStatus.status}, Ollama: ${ollama.status}, GPU: ${gpu.hasNvidiaGpu ? gpu.gpuName : 'None'}, RAM: ${memory.usedRAMGB}/${memory.totalRAMGB} GB`)
  return diagnosticsData
}
