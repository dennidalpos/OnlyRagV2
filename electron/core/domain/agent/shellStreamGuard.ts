import { ChildProcess } from 'node:child_process'
import { logger } from '../../../diagnostics'

export interface GuardedExecutionResult {
  stdout: string
  stderr: string
  exitCode: number
  interruptedByPrompt?: boolean
  timedOut?: boolean
}

export class NonInteractiveStreamSessionGuard {
  private static INTERACTIVE_PATTERNS = [
    /\[y\/n\]/i,
    /\(y\/n\)/i,
    /press any key/i,
    /enter configuration/i,
    /password:/i,
    /select an option/i,
    /do you want to continue\?/i,
  ]

  private static MAX_BUFFER_BYTES = 64 * 1024 // 64 KB Ring Buffer limit

  /**
   * Inject mandatory non-interactive shell flags into environment.
   */
  public static getNonInteractiveEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return {
      ...baseEnv,
      CI: 'true',
      PAGER: 'cat',
      NPM_CONFIG_YES: 'true',
      PIP_NO_INPUT: '1',
      DEBIAN_FRONTEND: 'noninteractive',
      GIT_TERMINAL_PROMPT: '0',
      PYTHONUNBUFFERED: '1',
    }
  }

  /**
   * Sanitizes Unix-style bash shell commands for execution on Windows PowerShell.
   * Converts bash brace expansions (e.g., mkdir -p src/{a,b}), touch, and chained && commands.
   */
  public static sanitizePowerShellCommand(cmd: string): string {
    if (!cmd || typeof cmd !== 'string') return cmd
    let clean = cmd.trim()

    // 1. Expand mkdir -p with brace syntax e.g. mkdir -p src/{package.json, index.html} or mkdir -p dir1 dir2
    clean = clean.replace(/mkdir\s+(?:-p\s+)?([^{\s;]+)\{([^}]+)\}/gi, (_m, prefix, inner) => {
      const items = inner.split(',').map((s: string) => s.trim()).filter(Boolean)
      const paths = items.map((item: string) => `"${prefix}${item}"`).join(', ')
      return `New-Item -ItemType Directory -Force -Path ${paths}`
    })

    // 2. Standard mkdir -p path -> New-Item -ItemType Directory -Force -Path "path"
    clean = clean.replace(/\bmkdir\s+-p\s+([^\s;&|]+)/gi, (_m, dirPath) => {
      return `New-Item -ItemType Directory -Force -Path "${dirPath}"`
    })

    // 3. Convert touch file -> New-Item -ItemType File -Force -Path "file"
    clean = clean.replace(/\btouch\s+([^\s;&|]+)/gi, (_m, filePath) => {
      return `New-Item -ItemType File -Force -Path "${filePath}"`
    })

    // 4. Convert cd dir && command -> Set-Location "dir"; command
    clean = clean.replace(/\bcd\s+([^\s;&|]+)\s*&&\s*/gi, (_m, dir) => {
      return `Set-Location "${dir}"; `
    })

    return clean
  }

  /**
   * Monitor output for interactive prompts and limit memory footprint via ring buffer.
   */
  public static async executeGuardedCommand(
    proc: ChildProcess,
    commandPayload: string,
    startDelimiter: string,
    endDelimiter: string,
    exitDelimiter: string,
    timeoutMs = 60000
  ): Promise<GuardedExecutionResult> {
    return new Promise<GuardedExecutionResult>((resolve) => {
      let circularBuffer = ''
      let stderrBuffer = ''
      let isSettled = false

      const cleanup = () => {
        if (timer) clearTimeout(timer)
        if (proc.stdout) proc.stdout.removeListener('data', onData)
        if (proc.stderr) proc.stderr.removeListener('data', onError)
      }

      const timer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true
          cleanup()
          resolve({
            stdout: circularBuffer.slice(-8000),
            stderr: '[TIMEOUT] Command execution exceeded time limit.',
            exitCode: 124,
            timedOut: true,
          })
        }
      }, timeoutMs)

      const onData = (chunk: Buffer) => {
        const text = chunk.toString('utf-8')
        circularBuffer += text

        // Cap memory buffer to MAX_BUFFER_BYTES
        if (circularBuffer.length > NonInteractiveStreamSessionGuard.MAX_BUFFER_BYTES) {
          circularBuffer = circularBuffer.slice(-NonInteractiveStreamSessionGuard.MAX_BUFFER_BYTES)
        }

        // 1. Early-detection scanner for interactive prompts
        for (const pattern of NonInteractiveStreamSessionGuard.INTERACTIVE_PATTERNS) {
          if (pattern.test(text)) {
            if (!isSettled) {
              isSettled = true
              cleanup()
              logger.log('WARN', 'ShellGuard', `Interactive prompt detected in command output: "${text.trim()}"`)

              if (proc.stdin) {
                proc.stdin.write('\x03') // Send SIGINT / Ctrl+C
              }

              resolve({
                stdout: circularBuffer.slice(-4000),
                stderr: `[INTERACTIVE PROMPT DETECTED] The command requested user interaction matching pattern ${pattern}. Aborted to prevent session freeze. Use non-interactive CLI flags (e.g. -y, --yes, --batch).`,
                exitCode: 130,
                interruptedByPrompt: true,
              })
              return
            }
          }
        }

        // 2. Normal completion check via delimiters
        if (circularBuffer.includes(endDelimiter) && circularBuffer.includes(exitDelimiter)) {
          if (!isSettled) {
            isSettled = true
            cleanup()

            const startIdx = circularBuffer.indexOf(startDelimiter)
            const endIdx = circularBuffer.indexOf(endDelimiter)
            const cleanStdout =
              startIdx !== -1 && endIdx !== -1
                ? circularBuffer.slice(startIdx + startDelimiter.length, endIdx).trim()
                : circularBuffer.trim()

            const exitMatch = circularBuffer.match(new RegExp(`(\\d+)\\s*${exitDelimiter}`))
            const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : 0

            resolve({
              stdout: cleanStdout,
              stderr: stderrBuffer.trim(),
              exitCode,
            })
          }
        }
      }

      const onError = (chunk: Buffer) => {
        stderrBuffer += chunk.toString('utf-8')
        if (stderrBuffer.length > 16384) {
          stderrBuffer = stderrBuffer.slice(-16384)
        }
      }

      if (proc.stdout) proc.stdout.on('data', onData)
      if (proc.stderr) proc.stderr.on('data', onError)

      if (proc.stdin) {
        proc.stdin.write(commandPayload)
      }
    })
  }
}
