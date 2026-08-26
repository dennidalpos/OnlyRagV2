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
    /** Per-model metadata from /api/tags' `details` field (parameter_size, quantization_level, ...), when available. */
    modelDetails?: Record<string, { parent_model?: string; format?: string; family?: string; families?: string[]; parameter_size?: string; quantization_level?: string }>
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

const URL_PATTERN = /\b(?:https?|ftp):\/\/[^\s"'<>]+/gi
const WINDOWS_PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\\\\)[^\s"'<>]+/g
const POSIX_PATH_PATTERN = /(?<![\w])\/(?:[^/\s"'<>]+\/)+[^/\s"'<>]*/g
const EXCEPTION_DETAIL_PATTERN = /(^|\n)([^\n]*(?:failed|failure|error|exception|could not|unable)[^:\n]*:\s*)([^\n]+)/gi

/**
 * Operational logs are support telemetry, not a second payload channel.
 * Keep the stable failure context while removing values that can identify local data or hosts.
 */
export function sanitizeLogMessage(message: string): string {
  return String(message)
    .replace(URL_PATTERN, (url) => {
      const punctuation = url.match(/[.,;:!?)]*$/)?.[0] ?? ''
      return `[url]${punctuation}`
    })
    .replace(WINDOWS_PATH_PATTERN, '[path]')
    .replace(POSIX_PATH_PATTERN, '[path]')
    .replace(EXCEPTION_DETAIL_PATTERN, '$1$2[details redacted]')
}

class SystemDiagnosticsLogger {
  private logFilePath: string
  private logsBuffer: LogEntry[] = []
  private maxBufferLength = 1000
  private maxLogFileSizeBytes = 2 * 1024 * 1024 // 2 MB max per log file

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
        } catch {
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
    const safeMessage = sanitizeLogMessage(message)
    const entry: LogEntry = { timestamp, level, message: safeMessage, category }
    this.logsBuffer.push(entry)
    if (this.logsBuffer.length > this.maxBufferLength) {
      this.logsBuffer.shift()
    }

    const logFormatted = `[${timestamp}] [${level}] [${category}]: ${safeMessage}\n`
    try {
      this.rotateLogsIfNeeded()
      fs.appendFileSync(this.logFilePath, logFormatted, 'utf-8')
    } catch (err) {
      console.error('Failed writing log to file:', err)
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log(logFormatted.trim())
    }
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

function getLocalManifestModels(): string[] {
  const possibleRoots: string[] = []
  if (process.env.OLLAMA_MODELS) {
    possibleRoots.push(path.join(process.env.OLLAMA_MODELS, 'manifests'))
    possibleRoots.push(process.env.OLLAMA_MODELS)
  }
  possibleRoots.push(path.join(os.homedir(), '.ollama', 'models', 'manifests'))

  const models: string[] = []
  for (const manifestsRoot of possibleRoots) {
    if (!fs.existsSync(manifestsRoot)) continue
    try {
      const walk = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            walk(fullPath)
          } else if (entry.isFile()) {
            const rel = path.relative(manifestsRoot, fullPath).replace(/\\/g, '/')
            const parts = rel.split('/')
            if (parts.length >= 3) {
              const namespace = parts[1]
              const model = parts[2]
              const tag = parts.slice(3).join(':') || 'latest'
              const modelName = namespace === 'library' ? `${model}:${tag}` : `${namespace}/${model}:${tag}`
              models.push(modelName)
            }
          }
        }
      }
      walk(manifestsRoot)
    } catch {
      // Ignore filesystem errors
    }
  }
  return models
}

function fetchJsonEndpoint(urlStr: string, timeoutMs = 4500): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.get(urlStr, { timeout: timeoutMs }, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data))
          } catch (e: any) {
            reject(new Error(`JSON parse error: ${e.message}`))
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Connection timeout'))
    })
  })
}

let lastOllamaSignature: string | null = null

export async function checkOllamaStatus(hostUrl = 'http://127.0.0.1:11434'): Promise<DiagnosticsData['ollama']> {
  const effectiveHost = hostUrl.replace('localhost', '127.0.0.1')
  const isLocal =
    effectiveHost.includes('127.0.0.1') ||
    effectiveHost.includes('0.0.0.0') ||
    effectiveHost.includes('localhost')

  const [tagsRes, v1Res] = await Promise.allSettled([
    fetchJsonEndpoint(`${effectiveHost}/api/tags`, 4500),
    fetchJsonEndpoint(`${effectiveHost}/v1/models`, 4500),
  ])

  const isOnline = tagsRes.status === 'fulfilled' || v1Res.status === 'fulfilled'
  if (!isOnline) {
    const err =
      tagsRes.status === 'rejected'
        ? tagsRes.reason?.message
        : v1Res.status === 'rejected'
        ? v1Res.reason?.message
        : 'Ollama unreachable'
    logger.log('WARN', 'Ollama', `Ollama offline or unreachable at ${hostUrl}: ${err}`)
    return {
      status: 'offline',
      url: hostUrl,
      modelsCount: 0,
      models: [],
      error: err,
    }
  }

  const modelSet = new Set<string>()
  const modelDetails: Record<string, { parent_model?: string; format?: string; family?: string; families?: string[]; parameter_size?: string; quantization_level?: string }> = {}

  // 1. Ingest models from /api/tags (also captures per-model `details` — parameter_size,
  // quantization_level — used by hardwareRecommendationEngine.estimateModelWeightGB for
  // accurate VRAM/disk footprint estimates instead of relying solely on the static table)
  if (tagsRes.status === 'fulfilled' && tagsRes.value?.models && Array.isArray(tagsRes.value.models)) {
    for (const m of tagsRes.value.models) {
      const name = m.name || m.model
      if (name && typeof name === 'string') {
        const trimmed = name.trim()
        modelSet.add(trimmed)
        if (m.details && typeof m.details === 'object') {
          modelDetails[trimmed] = m.details
        }
      }
    }
  }

  // 2. Ingest models from /v1/models (OpenAI-compatible Ollama endpoint)
  if (v1Res.status === 'fulfilled' && v1Res.value?.data && Array.isArray(v1Res.value.data)) {
    for (const item of v1Res.value.data) {
      if (item.id && typeof item.id === 'string') modelSet.add(item.id.trim())
    }
  }

  // 3. If running locally, discover installed models from disk manifests
  if (isLocal) {
    const localModels = getLocalManifestModels()
    for (const m of localModels) {
      modelSet.add(m)
    }
  }

  const models = Array.from(modelSet).sort((a, b) => a.localeCompare(b))
  if (lastOllamaSignature !== `online:${models.length}`) {
    lastOllamaSignature = `online:${models.length}`
    logger.log('INFO', 'Ollama', `Ollama online. Available models count: ${models.length}`)
  }
  return {
    status: 'online',
    url: hostUrl,
    modelsCount: models.length,
    models,
    modelDetails: Object.keys(modelDetails).length > 0 ? modelDetails : undefined,
  }
}

let cachedGpuResult: DiagnosticsData['gpu'] | null = null
let cachedGpuTimestamp = 0
let lastGpuSignature: string | null = null
const GPU_CACHE_TTL_MS = 30000 // 30 seconds TTL cache for GPU process execution

/**
 * Synchronous access to the last GPU snapshot captured by detectNvidiaGpu(), regardless
 * of TTL freshness. VRAM capacity doesn't change at runtime, so a slightly stale reading
 * is still correct for hardware-tier decisions — unlike detectNvidiaGpu() itself, this
 * never shells out, so callers on the hot agent-loop path (see HardwareProfileResolver)
 * can use it without an async round-trip or spawning nvidia-smi per step.
 */
export function getCachedGpuInfo(): DiagnosticsData['gpu'] | null {
  return cachedGpuResult
}

export async function detectNvidiaGpu(): Promise<DiagnosticsData['gpu']> {
  const now = Date.now()
  if (cachedGpuResult && now - cachedGpuTimestamp < GPU_CACHE_TTL_MS) {
    return cachedGpuResult
  }

  return new Promise((resolve) => {
    exec('nvidia-smi', (error, stdout) => {
      if (error || !stdout.trim()) {
        if (lastGpuSignature !== 'none') {
          lastGpuSignature = 'none'
          logger.log('INFO', 'GPU', `nvidia-smi check failed or GPU not present: ${error?.message || 'No output'}`)
        }
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

          const currentSignature = `${gpuName}:${cudaVersion}`
          if (lastGpuSignature !== currentSignature) {
            lastGpuSignature = currentSignature
            logger.log('INFO', 'GPU', `Detected GPU: ${gpuName} | VRAM: ${vramUsedMB}/${vramTotalMB} MB | CUDA: ${cudaVersion}`)
          }
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

let lastOverallDiagnosticsSignature: string | null = null

export async function runFullDiagnostics(
  sidecarStatus: DiagnosticsData['sidecar'] = { status: 'offline', error: 'Not checked' },
  ollamaHost = 'http://127.0.0.1:11434'
): Promise<DiagnosticsData> {
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

  const currentDiagSig = `${overallStatus}:${sidecarStatus.status}:${ollama.status}:${gpu.hasNvidiaGpu}`
  if (lastOverallDiagnosticsSignature !== currentDiagSig) {
    lastOverallDiagnosticsSignature = currentDiagSig
    logger.log('INFO', 'Diagnostics', `System status: ${overallStatus} | Sidecar: ${sidecarStatus.status} | Ollama: ${ollama.status} | GPU: ${gpu.hasNvidiaGpu ? gpu.gpuName : 'None'} | RAM: ${memory.usedRAMGB}/${memory.totalRAMGB} GB`)
  }

  return diagnosticsData
}
