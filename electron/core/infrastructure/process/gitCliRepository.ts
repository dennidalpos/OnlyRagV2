import { execSync, execFileSync } from 'node:child_process'

export interface GitStatusAndDiffResult {
  isGitRepo: boolean
  statusLines: string[]
  diffText: string
}

/** Thin git CLI wrapper: argv-array execFileSync for commit (injection-safe commit message), execSync for read-only inspection commands. */
export class GitCliRepository {
  commit(cwd: string, message: string): string {
    execFileSync('git', ['add', '-A'], { cwd, encoding: 'utf-8', timeout: 15000 })
    return execFileSync('git', ['commit', '-m', message], { cwd, encoding: 'utf-8', timeout: 15000 })
  }

  init(cwd: string): { success: boolean; message: string } {
    try {
      const out = execFileSync('git', ['init'], {
        cwd,
        encoding: 'utf-8',
        timeout: 15000,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      return { success: true, message: out.trim() }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to initialize Git repository'
      return { success: false, message }
    }
  }

  getStatusAndDiff(cwd: string): GitStatusAndDiffResult {
    try {
      // Check if inside a valid git repository
      try {
        const isInside = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
          cwd,
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim()
        if (isInside !== 'true') {
          return { isGitRepo: false, statusLines: [], diffText: '' }
        }
      } catch {
        return { isGitRepo: false, statusLines: [], diffText: '' }
      }

      // 1. Get status lines
      const statusOut = execFileSync('git', ['status', '--short'], {
        cwd,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const statusLines = statusOut
        .split(/\r?\n/)
        .map((l) => l.trimEnd())
        .filter((l) => l.length > 0)

      // 2. Untracked files handling for unified diff view
      let untrackedFiles: string[] = []
      try {
        const untrackedOut = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
          cwd,
          encoding: 'utf-8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        untrackedFiles = untrackedOut
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
      } catch {
        untrackedFiles = []
      }

      let diffText = ''
      try {
        if (untrackedFiles.length > 0) {
          execFileSync('git', ['add', '-N', '--', ...untrackedFiles], {
            cwd,
            encoding: 'utf-8',
            timeout: 15000,
            stdio: ['pipe', 'pipe', 'pipe'],
          })
        }

        diffText = execFileSync('git', ['diff', '-U3'], {
          cwd,
          encoding: 'utf-8',
          timeout: 15000,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      } finally {
        if (untrackedFiles.length > 0) {
          try {
            execFileSync('git', ['reset', '--', ...untrackedFiles], {
              cwd,
              encoding: 'utf-8',
              timeout: 15000,
              stdio: ['pipe', 'pipe', 'pipe'],
            })
          } catch {
            // Ignore reset cleanup errors
          }
        }
      }

      return {
        isGitRepo: true,
        statusLines,
        diffText: diffText.trim(),
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      return {
        isGitRepo: false,
        statusLines: [],
        diffText: `Git error: ${errorMsg}`,
      }
    }
  }

  /** Runs `git <argsString>` in cwd, e.g. run(cwd, 'status --short', 10000). */
  run(cwd: string, argsString: string, timeoutMs: number): string {
    return execSync(`git ${argsString}`, { cwd, encoding: 'utf-8', timeout: timeoutMs })
  }
}

export const gitCliRepository = new GitCliRepository()
