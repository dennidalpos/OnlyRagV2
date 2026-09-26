import type { DiagnosticsData } from '../../../../shared/types'

/** Host and Ollama probes used by application services; implemented in infrastructure/diagnostics. */
export interface HardwareProbePort {
  /** Last detected GPU, or null before the first detection finished. */
  getCachedGpuInfo(): DiagnosticsData['gpu'] | null
  /** Detects the GPU now (cached for 30 s) and updates getCachedGpuInfo. */
  detectGpu(): Promise<DiagnosticsData['gpu']>
  getMemoryInfo(): DiagnosticsData['memory']
  checkOllamaStatus(host?: string): Promise<DiagnosticsData['ollama']>
  runFullDiagnostics(sidecar: DiagnosticsData['sidecar'], host?: string): Promise<DiagnosticsData>
}
