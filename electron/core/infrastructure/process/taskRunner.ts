import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { logger } from '../../../diagnostics'

export interface ActiveTask {
  id: string
  type: 'ingestion' | 'ollama_stream' | 'export' | 'terminal_command'
  filePath?: string
  destroy: () => void
  createdAt: number
}

export class TaskRunner {
  private activeTasksMap = new Map<string, ActiveTask>()

  registerActiveTask(
    id: string,
    type: 'ingestion' | 'ollama_stream' | 'export' | 'terminal_command',
    destroyFn: () => void,
    filePath?: string
  ): string {
    const task: ActiveTask = {
      id,
      type,
      filePath,
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

      if (task.filePath && fs.existsSync(task.filePath)) {
        try {
          fs.unlinkSync(task.filePath)
          logger.log('INFO', 'TaskRunner', `Cleaned partial file residue: ${task.filePath}`)
        } catch (err: any) {
          logger.log('WARN', 'TaskRunner', `Could not delete partial file residue: ${err.message}`)
        }
      }

      return { success: true, message: `Task ${id} cancelled successfully and residues cleaned.` }
    } catch (err: any) {
      logger.log('ERROR', 'TaskRunner', `Error cancelling task ${id}: ${err.message}`)
      return { success: false, message: `Error cancelling task: ${err.message}` }
    }
  }

  cancelAllTasks() {
    logger.log('INFO', 'TaskRunner', `Cancelling all active tasks (${this.activeTasksMap.size} total)...`)
    for (const [id, task] of this.activeTasksMap.entries()) {
      try {
        task.destroy()
        if (task.filePath && fs.existsSync(task.filePath)) {
          try {
            fs.unlinkSync(task.filePath)
          } catch (unlinkErr: any) {
            logger.log('WARN', 'TaskRunner', `Failed unlinking partial residue for ${id}: ${unlinkErr.message}`)
          }
        }
      } catch (destroyErr: any) {
        logger.log('WARN', 'TaskRunner', `Failed destroying task ${id}: ${destroyErr.message}`)
      }
      this.activeTasksMap.delete(id)
    }
  }

  async cleanTempResiduals(): Promise<{ success: boolean; cleanedCount: number; bytesFreed: number }> {
    let cleanedCount = 0
    let bytesFreed = 0

    const userAppData = app.getPath('userData')
    const tempDir = app.getPath('temp')

    const dirsToClean = [
      path.join(userAppData, 'data', 'exports'),
      path.join(tempDir, 'OnlyRagV2_tmp'),
    ]

    for (const targetDir of dirsToClean) {
      if (fs.existsSync(targetDir)) {
        try {
          const files = fs.readdirSync(targetDir)
          for (const file of files) {
            const fullPath = path.join(targetDir, file)
            try {
              const stat = fs.statSync(fullPath)
              if (stat.isFile()) {
                bytesFreed += stat.size
                fs.unlinkSync(fullPath)
                cleanedCount++
              }
            } catch (fileErr: any) {
              logger.log('WARN', 'TaskRunner', `Could not clean file ${fullPath}: ${fileErr.message}`)
            }
          }
        } catch (err: any) {
          logger.log('WARN', 'TaskRunner', `Failed cleaning residual directory ${targetDir}: ${err.message}`)
        }
      }
    }

    const tempInstaller = path.join(tempDir, 'OllamaSetup.exe')
    if (fs.existsSync(tempInstaller)) {
      try {
        const stat = fs.statSync(tempInstaller)
        bytesFreed += stat.size
        fs.unlinkSync(tempInstaller)
        cleanedCount++
      } catch (instErr: any) {
        logger.log('WARN', 'TaskRunner', `Failed unlinking temp installer ${tempInstaller}: ${instErr.message}`)
      }
    }

    logger.log('INFO', 'TaskRunner', `Temp residual cleanup completed: ${cleanedCount} files removed, ${(bytesFreed / 1024 / 1024).toFixed(2)} MB freed.`)
    return { success: true, cleanedCount, bytesFreed }
  }

  async executePowerShellCommand(
    command: string,
    targetCwd?: string,
    timeoutMs?: number
  ): Promise<{ success: boolean; output: string; error?: string }> {
    if (typeof command !== 'string' || !command.trim()) {
      return { success: false, output: '', error: 'Invalid command' }
    }
    const effectiveTimeoutMs = Math.min(Math.max(timeoutMs || 300000, 5000), 1800000)
    logger.log('INFO', 'TaskRunner', `Executing PowerShell command: ${command}${targetCwd ? ` (CWD: ${targetCwd})` : ''} [Timeout: ${effectiveTimeoutMs / 1000}s]`)

    let executionCwd = app.getPath('userData')
    if (targetCwd && typeof targetCwd === 'string' && fs.existsSync(targetCwd)) {
      try {
        const st = fs.statSync(targetCwd)
        if (st.isDirectory()) {
          executionCwd = targetCwd
        }
      } catch (cwdErr: any) {
        logger.log('WARN', 'TaskRunner', `Failed checking CWD '${targetCwd}': ${cwdErr.message}`)
      }
    }

    let ptyModule: any = null
    try {
      ptyModule = require('node-pty')
    } catch {
      logger.log('INFO', 'TaskRunner', 'node-pty native module unavailable, using standard child_process fallback.')
      ptyModule = null
    }

    const execEnv = {
      ...process.env,
      CI: '1',
      PAGER: 'cat',
      NPM_CONFIG_YES: 'true',
      PIP_NO_INPUT: '1',
    }

    if (ptyModule) {
      return new Promise((resolve) => {
        let isCompleted = false
        let outputText = ''

        try {
          const ptyProcess = ptyModule.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
            name: 'xterm-color',
            cols: 120,
            rows: 30,
            cwd: executionCwd,
            env: execEnv as any,
          })

          const timeoutTimer = setTimeout(() => {
            if (!isCompleted && ptyProcess.pid) {
              logger.log(
                'WARN',
                'TaskRunner',
                `node-pty command timed out after ${effectiveTimeoutMs / 1000}s. Terminating process PID ${ptyProcess.pid}...`
              )
              if (process.platform === 'win32') {
                spawn('taskkill', ['/pid', ptyProcess.pid.toString(), '/f', '/t'])
              } else {
                ptyProcess.kill()
              }
            }
          }, effectiveTimeoutMs)

          ptyProcess.onData((data: string) => {
            outputText += data
          })

          ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
            isCompleted = true
            clearTimeout(timeoutTimer)
            logger.log('INFO', 'TaskRunner', `node-pty PowerShell process PID ${ptyProcess.pid} finished with exit code ${exitCode}`)
            const cleanOutput = outputText.replace(/\x1b\[[0-9;]*[a-zA-K]/g, '').trim()
            resolve({
              success: exitCode === 0,
              output: cleanOutput || (exitCode === 0 ? 'Command executed successfully.' : `Process exited with code ${exitCode}`),
              error: exitCode !== 0 ? cleanOutput || `Exit code ${exitCode}` : undefined,
            })
          })
        } catch (ptyErr: any) {
          logger.log('WARN', 'TaskRunner', `node-pty spawn failed, falling back to child_process: ${ptyErr.message}`)
          ptyModule = null
        }
      })
    }

    return new Promise((resolve) => {
      let isCompleted = false

      const psProcess = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
        {
          cwd: executionCwd,
          env: execEnv,
          windowsHide: true,
        }
      )

      let stdout = ''
      let stderr = ''

      const timeoutTimer = setTimeout(() => {
        if (!isCompleted && !psProcess.killed && psProcess.pid) {
          logger.log(
            'WARN',
            'TaskRunner',
            `Command timed out after ${effectiveTimeoutMs / 1000}s. Terminating process tree PID ${psProcess.pid}...`
          )
          if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', psProcess.pid.toString(), '/f', '/t'])
          } else {
            psProcess.kill('SIGKILL')
          }
        }
      }, effectiveTimeoutMs)

      psProcess.stdout?.on('data', (data) => {
        stdout += data.toString()
      })
      psProcess.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      psProcess.on('close', (code) => {
        isCompleted = true
        clearTimeout(timeoutTimer)
        logger.log('INFO', 'TaskRunner', `PowerShell process PID ${psProcess.pid} finished with exit code ${code}`)
        const output = (
          stdout ||
          stderr ||
          (code === 0 ? 'Command executed successfully.' : `Process exited with code ${code}`)
        ).trim()
        resolve({
          success: code === 0,
          output,
          error: code !== 0 ? stderr.trim() || `Exit code ${code}` : undefined,
        })
      })

      psProcess.on('error', (err) => {
        isCompleted = true
        clearTimeout(timeoutTimer)
        logger.log('ERROR', 'TaskRunner', `PowerShell process error: ${err.message}`)
        resolve({
          success: false,
          output: err.message,
          error: err.message,
        })
      })
    })
  }
}

export const taskRunner = new TaskRunner()
