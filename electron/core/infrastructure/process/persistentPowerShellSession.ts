import { spawn, ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import { logger } from '../../../diagnostics'
import { normalizePowerShellCommand } from './taskRunner'

export interface ShellExecutionOutput {
  stdout: string
  stderr: string
  code: number
  timedOut?: boolean
}

/**
 * Maintains a stateful, interactive PowerShell process for sequential commands in a workspace.
 * Preserves environment variables, working directory changes, and shell context between steps.
 */
export class PersistentPowerShellSession {
  private proc: ChildProcess | null = null
  private workspacePath: string
  private activeCwd: string
  private isBusy = false

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath
    this.activeCwd = workspacePath || process.cwd()
    this.initProcess()
  }

  private initProcess(): void {
    try {
      this.proc = spawn(
        'powershell.exe',
        ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
        {
          cwd: this.activeCwd || this.workspacePath || process.cwd(),
          env: {
            ...process.env,
            CI: '1',
            PAGER: 'cat',
            NPM_CONFIG_YES: 'true',
            PIP_NO_INPUT: '1',
            DEBIAN_FRONTEND: 'noninteractive',
            PYTHONUNBUFFERED: '1',
          },
        }
      )

      if (this.activeCwd && this.proc.stdin) {
        this.proc.stdin.write(`Set-Location -Path "${this.activeCwd.replace(/"/g, '""')}"\n`)
      }

      this.proc.on('error', (err) => {
        logger.log('ERROR', 'PersistentPowerShell', `Underlying shell process error: ${err.message}`)
      })
    } catch (err: any) {
      logger.log('ERROR', 'PersistentPowerShell', `Failed initializing PowerShell process: ${err.message}`)
    }
  }

  /**
   * Executes a command inside the persistent shell session.
   */
  public async execute(
    command: string,
    onOutputChunk?: (data: string) => void,
    onChildProcess?: (proc: ChildProcess) => void,
    timeoutMs = 60000
  ): Promise<ShellExecutionOutput> {
    if (!this.proc || this.proc.killed) {
      this.initProcess()
    }

    if (!this.proc) {
      return { stdout: '', stderr: 'Failed spawning shell process', code: 1 }
    }

    if (onChildProcess) {
      onChildProcess(this.proc)
    }

    this.isBusy = true
    const token = crypto.randomBytes(8).toString('hex')
    const startDelimiter = `__ONLYRAG_OUT_START_${token}__`
    const endDelimiter = `__ONLYRAG_OUT_END_${token}__`
    const exitDelimiter = `__ONLYRAG_EXIT_${token}__`

    return new Promise<ShellExecutionOutput>((resolve) => {
      let fullOutput = ''
      let stderrOutput = ''
      let isSettled = false

      const cleanup = () => {
        if (timer) clearTimeout(timer)
        if (this.proc?.stdout) this.proc.stdout.removeListener('data', onStdout)
        if (this.proc?.stderr) this.proc.stderr.removeListener('data', onStderr)
        this.isBusy = false
      }

      const timer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true
          cleanup()
          logger.log('WARN', 'PersistentPowerShell', `Command timed out after ${timeoutMs / 1000}s. Recreating shell process...`)
          try {
            if (process.platform === 'win32' && this.proc?.pid) {
              spawn('taskkill', ['/pid', this.proc.pid.toString(), '/f', '/t'])
            } else {
              this.proc?.kill('SIGKILL')
            }
          } catch {}
          this.initProcess()
          resolve({ stdout: fullOutput.trim(), stderr: `[Command timed out after ${timeoutMs / 1000}s limit]`, code: 124, timedOut: true })
        }
      }, timeoutMs)

      const onStdout = (chunk: Buffer) => {
        const text = chunk.toString('utf-8')
        fullOutput += text
        if (onOutputChunk) {
          onOutputChunk(text)
        }

        if (fullOutput.includes(endDelimiter) && fullOutput.includes(exitDelimiter)) {
          if (!isSettled) {
            isSettled = true
            cleanup()

            // Extract content between start and end delimiter
            let cleanOut = fullOutput
            const sIdx = cleanOut.indexOf(startDelimiter)
            if (sIdx !== -1) {
              cleanOut = cleanOut.slice(sIdx + startDelimiter.length)
            }
            const eIdx = cleanOut.indexOf(endDelimiter)
            const capturedStdout = eIdx !== -1 ? cleanOut.slice(0, eIdx) : cleanOut

            // Extract exit code
            let exitCode = 0
            const exIdx = fullOutput.indexOf(endDelimiter)
            const exitPart = fullOutput.slice(exIdx + endDelimiter.length)
            const codeMatch = exitPart.match(new RegExp(`(\\d+)\\s*${exitDelimiter}`))
            if (codeMatch && codeMatch[1]) {
              exitCode = parseInt(codeMatch[1], 10)
            }

            resolve({
              stdout: capturedStdout.trim(),
              stderr: stderrOutput.trim(),
              code: exitCode,
            })
          }
        }
      }

      const onStderr = (chunk: Buffer) => {
        const text = chunk.toString('utf-8')
        stderrOutput += text
        if (onOutputChunk) {
          onOutputChunk(text)
        }
      }

      this.proc?.stdout?.on('data', onStdout)
      this.proc?.stderr?.on('data', onStderr)

      // Wrap command with delimiters and status code capture
      const normalized = normalizePowerShellCommand(command)
      const wrappedPayload = `Write-Output "${startDelimiter}"\n${normalized}\nWrite-Output "${endDelimiter}"\nWrite-Output "$LASTEXITCODE"\nWrite-Output "${exitDelimiter}"\n`
      this.proc?.stdin?.write(wrappedPayload)
    })
  }

  /**
   * Terminates the persistent shell session.
   */
  public dispose(): void {
    if (this.proc && !this.proc.killed) {
      try {
        if (process.platform === 'win32' && this.proc.pid) {
          spawn('taskkill', ['/pid', this.proc.pid.toString(), '/f', '/t'])
        } else {
          this.proc.kill('SIGKILL')
        }
      } catch {}
      this.proc = null
    }
  }

  public get isRunning(): boolean {
    return Boolean(this.proc && !this.proc.killed)
  }
}
