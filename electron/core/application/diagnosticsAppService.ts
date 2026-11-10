import path from 'node:path'
import type { DesktopShellPort } from '../domain/ports/desktopShellPort'
import type { HardwareProbePort } from '../domain/ports/hardwareProbePort'
import type { DiagnosticsData } from '../../../shared/types'
import { electronDesktopShell } from '../infrastructure/electron/electronDesktopShell'
import { hardwareProbe } from '../infrastructure/diagnostics/hardwareProbe'
import { logger } from '../infrastructure/logging/logger'
import type { LogEntry, LogLevel } from '../../../shared/types'
import { sidecarAppService } from './sidecarAppService'

export class DiagnosticsAppService {
  constructor(
    private readonly desktop: Pick<DesktopShellPort, 'openPath'> = electronDesktopShell,
    private readonly probe: Pick<HardwareProbePort, 'runFullDiagnostics'> = hardwareProbe,
    private readonly checkSidecarHealth: () => Promise<DiagnosticsData['sidecar']> = () => sidecarAppService.checkHealth(),
  ) {}

  /** Full host report for `diagnostics:run`: Sidecar health first, then Ollama, GPU, memory and requirements. */
  public async runDiagnostics(host?: string): Promise<DiagnosticsData> {
    return this.probe.runFullDiagnostics(await this.checkSidecarHealth(), host)
  }

  public getLogs(): LogEntry[] {
    return logger.getLogs()
  }

  public clearLogs(): void {
    logger.clearLogs()
  }

  public getLogFilePath(): string {
    return logger.getLogFilePath()
  }

  public logTelemetry(level: LogLevel, category: string, message: string): void {
    logger.log(level, category, message)
  }

  public async openLogsFolder(): Promise<{ success: boolean; path: string }> {
    let logsDir = path.dirname(this.getLogFilePath())
    try {
      logsDir = logger.ensureLogDir()
    } catch {
      // Opening the path below provides the same best-effort behavior as before.
    }
    await this.desktop.openPath(logsDir)
    return { success: true, path: logsDir }
  }
}

export const diagnosticsAppService = new DiagnosticsAppService()
