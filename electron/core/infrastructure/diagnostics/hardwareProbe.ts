import { checkOllamaStatus, getCachedGpuInfo, getMemoryInfo, runFullDiagnostics } from '../../../diagnostics'
import type { HardwareProbePort } from '../../domain/ports/hardwareProbePort'

/** Adapter of HardwareProbePort over the host probes in electron/diagnostics.ts. */
export const hardwareProbe: HardwareProbePort = {
  getCachedGpuInfo,
  getMemoryInfo,
  checkOllamaStatus,
  runFullDiagnostics,
}
