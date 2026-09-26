import { spawn, execFileSync, ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { logger } from '../logging/logger'
import { normalizePowerShellCommand } from './powerShellCommand'
import { detectInteractivePrompt } from '../../domain/agent/shellStreamGuard'
import { errorMessage } from '../../../../shared/domain/errors/errorMessage'

export interface ShellExecutionOutput {
  stdout: string
  stderr: string
  code: number
  timedOut?: boolean
  interruptedByPrompt?: boolean
}

/**
 * Maintains a stateful, interactive PowerShell process for sequential commands in a workspace.
 * Preserves environment variables, working directory changes, and shell context between steps.
 */
/** Silence after a prompt-like last line before the command is treated as waiting for input. */
const PROMPT_QUIET_MS = 1500

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

  public isExecuting(): boolean {
    return this.isBusy
  }

  /** The shell's working directory after the last command (a `cd` persists between commands). */
  public get currentDirectory(): string {
    return this.activeCwd
  }

  private initProcess(): void {
    try {
      this.proc = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], {
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
      })

      // Windows PowerShell writes redirected output in the OEM code page (CP850 on Italian systems)
      // and decodes native programs' output with it too, while Node reads UTF-8: accented text and
      // test runners' check marks arrived garbled. UTF-8 on both sides fixes it.
      this.proc.stdin?.write(
        'try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}\n',
      )
      if (this.activeCwd && this.proc.stdin) {
        this.proc.stdin.write(`Set-Location -Path "${this.activeCwd.replace(/"/g, '""')}"\n`)
      }

      this.proc.on('error', (err) => {
        logger.log('ERROR', 'PersistentPowerShell', `Underlying shell process error: ${err.message}`)
      })
    } catch (err: unknown) {
      logger.log('ERROR', 'PersistentPowerShell', `Failed initializing PowerShell process: ${errorMessage(err)}`)
    }
  }

  /**
   * Executes a command inside the persistent shell session.
   */
  public async execute(
    command: string,
    onOutputChunk?: (data: string) => void,
    onChildProcess?: (proc: ChildProcess) => void,
    timeoutMs = 60000,
    signal?: AbortSignal,
  ): Promise<ShellExecutionOutput> {
    if (signal?.aborted) {
      return { stdout: '', stderr: '[Command cancelled before execution]', code: 130 }
    }
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
    const cwdMarker = `__ONLYRAG_CWD_${token}__`

    return new Promise<ShellExecutionOutput>((resolve) => {
      let fullOutput = ''
      let stderrOutput = ''
      let isSettled = false
      // A multi-byte character can be split across two chunks; per-stream decoders keep it whole.
      const stdoutDecoder = new StringDecoder('utf8')
      const stderrDecoder = new StringDecoder('utf8')

      let promptTimer: NodeJS.Timeout | null = null
      const cleanup = () => {
        if (timer) clearTimeout(timer)
        if (promptTimer) clearTimeout(promptTimer)
        signal?.removeEventListener('abort', abortHandler)
        if (this.proc?.stdout) this.proc.stdout.removeListener('data', onStdout)
        if (this.proc?.stderr) this.proc.stderr.removeListener('data', onStderr)
        this.isBusy = false
      }

      const abortHandler = () => {
        if (isSettled) return
        isSettled = true
        cleanup()
        try {
          if (process.platform === 'win32' && this.proc?.pid) {
            spawn('taskkill', ['/pid', this.proc.pid.toString(), '/f', '/t'])
          } else {
            this.proc?.kill('SIGKILL')
          }
        } catch {}
        this.initProcess()
        resolve({ stdout: fullOutput.trim(), stderr: '[Command cancelled by AbortSignal]', code: 130 })
      }

      signal?.addEventListener('abort', abortHandler, { once: true })

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
        const text = stdoutDecoder.write(chunk)
        fullOutput += text
        if (onOutputChunk) {
          onOutputChunk(text)
        }

        // Interactive-prompt guard: no human is present in the autonomous agent loop to answer a `[y/n]`/password-style prompt, so abort instead of blocking here until the full timeout elapses (see shellStreamGuard.ts's detectInteractivePrompt).
        // Only the last line counts, and only once the command has gone quiet after it: a prompt
        // waits there, while a test log that merely prints "password:" or "(y/n)" keeps going.
        if (promptTimer) clearTimeout(promptTimer)
        promptTimer = null
        const lastLine = fullOutput.trimEnd().split('\n').pop() || ''
        const promptPattern = lastLine.includes(endDelimiter) || lastLine.includes(exitDelimiter) ? null : detectInteractivePrompt(lastLine)
        if (promptPattern && !isSettled) {
          promptTimer = setTimeout(() => abortOnPrompt(promptPattern), PROMPT_QUIET_MS)
        }

        if (fullOutput.includes(endDelimiter) && fullOutput.includes(exitDelimiter)) {
          if (!isSettled) {
            isSettled = true
            cleanup()
            resolve(parseDelimitedResult())
          }
        }
      }

      const abortOnPrompt = (promptPattern: RegExp) => {
        if (!isSettled) {
          isSettled = true
          cleanup()
          logger.log('WARN', 'PersistentPowerShell', `Interactive prompt detected in command output: "${fullOutput.trimEnd().split('\n').pop() || ''}"`)
          try {
            this.proc?.stdin?.write('\x03') // Send SIGINT / Ctrl+C to abort the foreground command
          } catch {}
          // The shell process may be left in an indeterminate state after an unanswered interactive prompt (e.g.
          try {
            if (process.platform === 'win32' && this.proc?.pid) {
              spawn('taskkill', ['/pid', this.proc.pid.toString(), '/f', '/t'])
            } else {
              this.proc?.kill('SIGKILL')
            }
          } catch {}
          this.initProcess()
          resolve({
            stdout: fullOutput.trim(),
            stderr: `[INTERACTIVE PROMPT DETECTED] The command requested user interaction matching pattern ${promptPattern}. Aborted to prevent session freeze. Use non-interactive CLI flags (e.g. -y, --yes, --batch).`,
            code: 130,
            interruptedByPrompt: true,
          })
        }
      }

      const parseDelimitedResult = (): ShellExecutionOutput => {
        // Extract content between start and end delimiter
        let cleanOut = fullOutput
        const sIdx = cleanOut.indexOf(startDelimiter)
        if (sIdx !== -1) {
          cleanOut = cleanOut.slice(sIdx + startDelimiter.length)
        }
        const eIdx = cleanOut.indexOf(endDelimiter)
        const capturedStdout = eIdx !== -1 ? cleanOut.slice(0, eIdx) : cleanOut

        // Extract exit code. Negative codes are real: Windows reports NTSTATUS crashes as negative exit codes.
        let exitCode = 0
        const exitPart = fullOutput.slice(fullOutput.indexOf(endDelimiter) + endDelimiter.length)
        const codeMatch = exitPart.match(new RegExp(`(-?\\d+)\\s*${exitDelimiter}`))
        if (codeMatch?.[1]) {
          exitCode = parseInt(codeMatch[1], 10)
        }

        const cwdLine = exitPart.split(/\r?\n/).find((line) => line.startsWith(cwdMarker))
        const directory = cwdLine?.slice(cwdMarker.length).trim()
        if (directory) this.activeCwd = directory

        return { stdout: capturedStdout.trim(), stderr: stderrOutput.trim(), code: exitCode }
      }

      const onStderr = (chunk: Buffer) => {
        const text = stderrDecoder.write(chunk)
        stderrOutput += text
        if (onOutputChunk) {
          onOutputChunk(text)
        }
      }

      this.proc?.stdout?.on('data', onStdout)
      this.proc?.stderr?.on('data', onStderr)

      // Wrap command with delimiters and status capture.
      // PowerShell reads its redirected stdin in the OEM code page, fixed when the process starts, so
      // a command with non-ASCII text (a path, a commit message) arrives garbled. Such a command is
      // sent as ASCII base64 and decoded as UTF-8 inside the shell; Invoke-Expression runs it in the
      // session scope, so directory and variable changes persist as before.
      const normalizedCommand = normalizePowerShellCommand(command)
      const normalized = /^[\x20-\x7e\t\r\n]*$/.test(normalizedCommand)
        ? normalizedCommand
        : `Invoke-Expression ([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${Buffer.from(normalizedCommand, 'utf8').toString('base64')}')))`
      const statusExpression = '$(if ($LASTEXITCODE -ne 0) { $LASTEXITCODE } elseif (-not $__onlyrag_ok) { 1 } else { 0 })'
      const wrappedPayload =
        `$global:LASTEXITCODE = 0\n` +
        `Write-Output "${startDelimiter}"\n` +
        `${normalized}\n` +
        `$__onlyrag_ok = $?\n` +
        `Write-Output "${endDelimiter}"\n` +
        `Write-Output "${cwdMarker}$((Get-Location).ProviderPath)"\n` +
        `Write-Output "${statusExpression}"\n` +
        `Write-Output "${exitDelimiter}"\n`
      this.proc?.stdin?.write(wrappedPayload)
    })
  }

  /** Re-reads the machine and user PATH and applies it to BOTH this shell and the host process. */
  public refreshEnvironmentPath(): boolean {
    if (process.platform !== 'win32') return false
    try {
      const combined = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "[System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')",
        ],
        { encoding: 'utf-8', timeout: 10000 },
      )
        .toString()
        .trim()

      if (!combined) return false

      process.env.Path = combined
      process.env.PATH = combined

      if (this.proc?.stdin && !this.proc.killed) {
        this.proc.stdin.write(`$env:Path = "${combined.replace(/"/g, '""')}"\n`)
      }

      logger.log('INFO', 'PersistentPowerShell', 'Environment PATH refreshed after toolchain installation.')
      return true
    } catch (err: unknown) {
      logger.log('WARN', 'PersistentPowerShell', `Could not refresh PATH: ${errorMessage(err)}`)
      return false
    }
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
