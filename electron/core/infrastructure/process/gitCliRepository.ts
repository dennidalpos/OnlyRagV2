import { execSync, execFileSync } from 'node:child_process'

/** Thin git CLI wrapper: argv-array execFileSync for commit (injection-safe commit message), execSync for read-only inspection commands. */
export class GitCliRepository {
  commit(cwd: string, message: string): string {
    execFileSync('git', ['add', '-A'], { cwd, encoding: 'utf-8', timeout: 15000 })
    return execFileSync('git', ['commit', '-m', message], { cwd, encoding: 'utf-8', timeout: 15000 })
  }

  /** Runs `git <argsString>` in cwd, e.g. run(cwd, 'status --short', 10000). */
  run(cwd: string, argsString: string, timeoutMs: number): string {
    return execSync(`git ${argsString}`, { cwd, encoding: 'utf-8', timeout: timeoutMs })
  }
}

export const gitCliRepository = new GitCliRepository()
