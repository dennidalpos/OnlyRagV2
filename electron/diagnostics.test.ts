import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { logger, generateDiagnosticsReport, DiagnosticsData } from './diagnostics'

describe('SystemDiagnosticsLogger Tests', () => {
  it('should write logs and clear both in-memory buffer and physical file on disk', () => {
    logger.log('INFO', 'TestCategory', 'Test log message for physical file clear verification')
    const logs = logger.getLogs()
    expect(logs.length).toBeGreaterThan(0)
    expect(logs.some((l) => l.message.includes('Test log message'))).toBe(true)

    const logPath = logger.getLogFilePath()
    expect(fs.existsSync(logPath)).toBe(true)

    // Call clearLogs
    logger.clearLogs()

    // Buffer should be empty
    expect(logger.getLogs()).toHaveLength(0)

    // Physical file on disk should be empty (0 bytes or blank string)
    const diskContent = fs.readFileSync(logPath, 'utf-8')
    expect(diskContent).toBe('')
  })

  it('should generate a markdown diagnostics report properly', () => {
    const mockDiagnostics: DiagnosticsData = {
      sidecar: { status: 'online', engine: 'FastAPI + LanceDB', documentsCount: 5, chunksCount: 42 },
      ollama: { status: 'online', url: 'http://127.0.0.1:11434', modelsCount: 2, models: ['qwen2.5-coder:7b', 'llama3.2:3b'] },
      gpu: { hasNvidiaGpu: true, gpuName: 'NVIDIA RTX 4070', vramTotalMB: 12288, vramUsedMB: 2048, cudaVersion: '12.4', driverVersion: '555.85' },
      memory: { totalRAMGB: 32, freeRAMGB: 18, usedRAMGB: 14, ramUsagePercent: 43.8 },
      system: { platform: 'win32', arch: 'x64', cpusCount: 16, cpuModel: 'AMD Ryzen 7 7800X3D' },
      requirements: {
        isOsSupported: true,
        hasMinRam: true,
        hasRecRam: true,
        isOllamaReady: true,
        isGpuAccelerated: true,
        isSidecarReady: true,
        overallStatus: 'optimal',
      },
      timestamp: '2026-08-14T10:00:00.000Z',
    }

    const report = generateDiagnosticsReport(mockDiagnostics, [
      { timestamp: '2026-08-14T10:00:00.000Z', level: 'INFO', category: 'Test', message: 'Report generation test log' },
    ])

    expect(report).toContain('OnlyRag V2 - System Diagnostics & Health Report')
    expect(report).toContain('NVIDIA RTX 4070')
    expect(report).toContain('qwen2.5-coder:7b')
    expect(report).toContain('Indexed Documents: 5 docs (42 vector chunks)')
    expect(report).toContain('Report generation test log')
  })
})
