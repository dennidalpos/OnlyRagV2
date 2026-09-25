import type { DiagnosticsData, SystemRequirementsCheck, UntrustedJson } from '../shared/types'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { exec } from 'node:child_process'
import { logger } from './core/infrastructure/logging/logger'
import { DEFAULT_OLLAMA_HOST } from '../shared/domain/ollamaHost'
import { errorMessage } from '../shared/domain/errors/errorMessage'

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

function fetchJsonEndpoint(urlStr: string, timeoutMs = 4500): Promise<UntrustedJson> {
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
          } catch (e: unknown) {
            reject(new Error(`JSON parse error: ${errorMessage(e)}`))
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

export async function checkOllamaStatus(hostUrl = DEFAULT_OLLAMA_HOST): Promise<DiagnosticsData['ollama']> {
  const effectiveHost = hostUrl.replace('localhost', '127.0.0.1')
  const isLocal = effectiveHost.includes('127.0.0.1') || effectiveHost.includes('0.0.0.0') || effectiveHost.includes('localhost')

  const [tagsRes, v1Res] = await Promise.allSettled([
    fetchJsonEndpoint(`${effectiveHost}/api/tags`, 4500),
    fetchJsonEndpoint(`${effectiveHost}/v1/models`, 4500),
  ])

  const isOnline = tagsRes.status === 'fulfilled' || v1Res.status === 'fulfilled'
  if (!isOnline) {
    const err = tagsRes.status === 'rejected' ? tagsRes.reason?.message : v1Res.status === 'rejected' ? v1Res.reason?.message : 'Ollama unreachable'
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
  const modelDetails: Record<
    string,
    { parent_model?: string; format?: string; family?: string; families?: string[]; parameter_size?: string; quantization_level?: string }
  > = {}

  // 1.
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

/** Synchronous access to the last GPU snapshot captured by detectNvidiaGpu(), regardless of TTL freshness. */
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
            const parts = csvStdout
              .trim()
              .split('\n')[0]
              .split(',')
              .map((s) => s.trim())
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
      } catch (e: unknown) {
        logger.log('ERROR', 'GPU', `Failed parsing nvidia-smi output: ${errorMessage(e)}`)
        const res: DiagnosticsData['gpu'] = {
          hasNvidiaGpu: false,
          error: errorMessage(e),
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
  ollamaHost = DEFAULT_OLLAMA_HOST,
): Promise<DiagnosticsData> {
  const [ollama, gpu] = await Promise.all([checkOllamaStatus(ollamaHost), detectNvidiaGpu()])

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
    logger.log(
      'INFO',
      'Diagnostics',
      `System status: ${overallStatus} | Sidecar: ${sidecarStatus.status} | Ollama: ${ollama.status} | GPU: ${gpu.hasNvidiaGpu ? gpu.gpuName : 'None'} | RAM: ${memory.usedRAMGB}/${memory.totalRAMGB} GB`,
    )
  }

  return diagnosticsData
}
