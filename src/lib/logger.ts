import { LogLevel } from '../types'

/**
 * Lightweight Frontend Telemetry Logger for OnlyRag V2
 * Logs to standard browser console and streams structured telemetry to the Electron Main Logger.
 */
class FrontendLogger {
  private log(level: LogLevel, category: string, message: string): void {
    const formatted = `[${new Date().toISOString()}] [${level}] [${category}]: ${message}`

    switch (level) {
      case 'ERROR':
        console.error(formatted)
        break
      case 'WARN':
        console.warn(formatted)
        break
      case 'DEBUG':
        console.debug(formatted)
        break
      default:
        console.log(formatted)
        break
    }

    if (window.electronAPI?.logTelemetry) {
      window.electronAPI.logTelemetry(level, category, message).catch(() => {})
    }
  }

  public info(category: string, message: string): void {
    this.log('INFO', category, message)
  }

  public warn(category: string, message: string): void {
    this.log('WARN', category, message)
  }

  public error(category: string, message: string): void {
    this.log('ERROR', category, message)
  }

  public debug(category: string, message: string): void {
    this.log('DEBUG', category, message)
  }
}

export const logger = new FrontendLogger()
