import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { PersistentPowerShellSession } from './persistentPowerShellSession'
import { normalizePowerShellCommand } from './powerShellCommand'
import { logger } from '../logging/logger'
import { errorMessage } from '../../../../shared/domain/errors/errorMessage'

export type ActiveTaskType = 'ingestion' | 'translation' | 'ollama_stream' | 'export' | 'terminal_command'

export interface ActiveTask {
  id: string
  type: ActiveTaskType
  sourcePath?: string
  temporaryResiduePath?: string
  destroy: () => void
  createdAt: number
}

export interface ActiveTaskPaths {
  sourcePath?: string
  temporaryResiduePath?: string
}

export class TaskRunner {
  private activeTasksMap = new Map<string, ActiveTask>()
  private terminalSessions = new Map<string, PersistentPowerShellSession>()

  registerActiveTask(id: string, type: ActiveTaskType, destroyFn: () => void, paths: ActiveTaskPaths = {}): string {
    const task: ActiveTask = {
      id,
      type,
      ...paths,
      destroy: destroyFn,
      createdAt: Date.now(),
    }
    this.activeTasksMap.set(id, task)
    logger.log('INFO', 'TaskRunner', `Registered active task [${type}]: ${id}`)
    return id
  }

  unregisterActiveTask(id: string) {
    if (this.activeTasksMap.has(id)) {
      this.activeTasksMap.delete(id)
      logger.log('INFO', 'TaskRunner', `Unregistered completed task: ${id}`)
    }
  }

  cancelTask(id: string): { success: boolean; message: string } {
    const task = this.activeTasksMap.get(id)
    if (!task) {
      logger.log('WARN', 'TaskRunner', `Task cancellation requested for non-existent or completed task: ${id}`)
      return { success: false, message: 'Task not found or already completed.' }
    }

    try {
      logger.log('INFO', 'TaskRunner', `Cancelling task [${task.type}]: ${id}`)
      task.destroy()
      this.activeTasksMap.delete(id)
      this.cleanupTemporaryResidue(task)

      return { success: true, message: `Task ${id} cancelled successfully and residues cleaned.` }
    } catch (err: unknown) {
      logger.log('ERROR', 'TaskRunner', `Error cancelling task ${id}: ${errorMessage(err)}`)
      return { success: false, message: `Error cancelling task: ${errorMessage(err)}` }
    }
  }

  cancelAllTasks() {
    logger.log('INFO', 'TaskRunner', `Cancelling all active tasks (${this.activeTasksMap.size} total)...`)
    for (const session of this.terminalSessions.values()) session.dispose()
    this.terminalSessions.clear()
    for (const [id, task] of this.activeTasksMap.entries()) {
      try {
        task.destroy()
      } catch (destroyErr: unknown) {
        logger.log('WARN', 'TaskRunner', `Failed destroying task ${id}: ${errorMessage(destroyErr)}`)
      } finally {
        this.cleanupTemporaryResidue(task)
        this.activeTasksMap.delete(id)
      }
    }
  }

  private cleanupTemporaryResidue(task: ActiveTask): void {
    const residuePath = task.temporaryResiduePath
    if (!residuePath || !fs.existsSync(residuePath)) return

    try {
      fs.unlinkSync(residuePath)
      logger.log('INFO', 'TaskRunner', `Cleaned temporary residue: ${residuePath}`)
    } catch (err: unknown) {
      logger.log('WARN', 'TaskRunner', `Failed unlinking temporary residue for ${task.id}: ${errorMessage(err)}`)
    }
  }

  async cleanTempResiduals(): Promise<{ success: boolean; cleanedCount: number; bytesFreed: number }> {
    let cleanedCount = 0
    let bytesFreed = 0

    const userAppData = app?.getPath ? app.getPath('userData') : path.join(os.tmpdir(), 'OnlyRagV2_userData')
    const tempDir = app?.getPath ? app.getPath('temp') : os.tmpdir()

    const dirsToClean = [path.join(userAppData, 'data', 'exports'), path.join(tempDir, 'OnlyRagV2_tmp'), path.join(tempDir, 'onlyrag_temp')]

    for (const d of dirsToClean) {
      if (fs.existsSync(d)) {
        try {
          const files = fs.readdirSync(d)
          for (const f of files) {
            const p = path.join(d, f)
            try {
              const st = fs.statSync(p)
              if (st.isFile()) {
                bytesFreed += st.size
                fs.unlinkSync(p)
                cleanedCount++
              }
            } catch {}
          }
        } catch (err: unknown) {
          logger.log('WARN', 'TaskRunner', `Error reading residual dir ${d}: ${errorMessage(err)}`)
        }
      }
    }

    logger.log('INFO', 'TaskRunner', `Cleaned ${cleanedCount} temporary residual files, freed ${(bytesFreed / 1024 / 1024).toFixed(2)} MB.`)
    return { success: true, cleanedCount, bytesFreed }
  }

  /** Windows-only: force-kills a whole process tree by pid via `taskkill /f /t`. */
  killProcessTreeWindows(pid: number): void {
    spawn('taskkill', ['/pid', pid.toString(), '/f', '/t'])
  }

  /** Probes whether a CLI tool (git, node, python, ...) is resolvable on PATH. */
  checkToolAvailable(toolCmd: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('powershell.exe', ['-NoProfile', '-Command', `Get-Command ${toolCmd} -ErrorAction SilentlyContinue`], { windowsHide: true })
      proc.on('close', (code) => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })
  }

  async executePowerShellCommand(command: string, targetCwd?: string, timeoutMs?: number): Promise<{ success: boolean; output: string; error?: string }> {
    return this.executeTerminalCommand(command, targetCwd, undefined, timeoutMs)
  }

  async executeTerminalCommand(
    command: string,
    targetCwd?: string,
    onChunk?: (chunk: string) => void,
    timeoutMs?: number,
  ): Promise<{ success: boolean; output: string; error?: string }> {
    if (typeof command !== 'string' || !command.trim()) {
      return { success: false, output: '', error: 'Invalid command' }
    }
    const normalizedCommand = normalizePowerShellCommand(command)
    const effectiveTimeoutMs = Math.min(Math.max(timeoutMs || 300000, 5000), 1800000)
    let executionCwd = app?.getPath ? app.getPath('userData') : process.cwd()
    if (targetCwd && typeof targetCwd === 'string' && fs.existsSync(targetCwd)) {
      try {
        if (fs.statSync(targetCwd).isDirectory()) executionCwd = targetCwd
      } catch (cwdErr: unknown) {
        logger.log('WARN', 'TaskRunner', `Failed checking CWD '${targetCwd}': ${errorMessage(cwdErr)}`)
      }
    }

    logger.log('INFO', 'TaskRunner', `Executing PowerShell command: ${normalizedCommand} (CWD: ${executionCwd}) [Timeout: ${effectiveTimeoutMs / 1000}s]`)
    let session = this.terminalSessions.get(executionCwd)
    if (!session || !session.isRunning) {
      session = new PersistentPowerShellSession(executionCwd)
      this.terminalSessions.set(executionCwd, session)
    }
    if (session.isExecuting()) {
      return { success: false, output: '', error: 'A command is already running in this terminal.' }
    }
    try {
      const result = await session.execute(normalizedCommand, onChunk, undefined, effectiveTimeoutMs)
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
      return {
        success: result.code === 0,
        output: output || (result.code === 0 ? 'Command executed successfully.' : `Process exited with code ${result.code}`),
        error: result.code === 0 ? undefined : result.stderr.trim() || `Exit code ${result.code}`,
      }
    } catch (error: unknown) {
      const message = errorMessage(error)
      logger.log('ERROR', 'TaskRunner', `PowerShell command failed: ${message}`)
      return { success: false, output: message, error: message }
    }
  }
}

export const taskRunner = new TaskRunner()
