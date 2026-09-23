import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { sanitizeLogMessage } from '../../../logRedactor'

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  category: string
}

/** Process-wide Main logger: redacts, keeps a bounded in-memory buffer and appends to a rotated userData/logs/app.log. */
class SystemDiagnosticsLogger {
  private logFilePath: string
  private logsBuffer: LogEntry[] = []
  private maxBufferLength = 1000
  private maxLogFileSizeBytes = 2 * 1024 * 1024 // 2 MB max per log file

  constructor() {
    const baseDir = app && typeof app.getPath === 'function' ? app.getPath('userData') : process.cwd()
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

  /** Rebind after main.ts has applied the canonical app name or an isolated E2E userData path. */
  public rebindToUserData(baseDir: string): void {
    const nextLogDir = path.join(baseDir, 'logs')
    fs.mkdirSync(nextLogDir, { recursive: true })
    const nextLogFilePath = path.join(nextLogDir, 'app.log')
    if (nextLogFilePath === this.logFilePath) return
    this.logFilePath = nextLogFilePath
    this.rotateLogsIfNeeded()
    this.log('INFO', 'Logger', `System Diagnostics Logger rebound to canonical userData. Log path: ${this.logFilePath}`)
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
      try {
        console.log(logFormatted.trim())
      } catch {
        // A detached Electron process can outlive the terminal pipe that started it.
        // File logging must keep working without recursively crashing the global handler.
      }
    }
    return entry
  }

  /** Returns the directory holding app.log, creating it if it was removed at runtime. */
  public ensureLogDir(): string {
    const logDir = path.dirname(this.logFilePath)
    fs.mkdirSync(logDir, { recursive: true })
    return logDir
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
