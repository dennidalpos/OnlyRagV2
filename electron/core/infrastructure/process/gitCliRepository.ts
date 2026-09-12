import { execSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface GitStatusAndDiffResult {
  isGitRepo: boolean
  statusLines: string[]
  diffText: string
}

export interface GitCommitPreview {
  paths: string[]
  diffText: string
  diffHash: string
}

/** Git CLI wrapper with argv-based commits and read-only inspection commands. */
export class GitCliRepository {
  private normalizeOwnedPaths(cwd: string, ownedPaths: readonly string[]): string[] {
    const root = path.resolve(cwd)
    const seen = new Set<string>()
    const relativePaths: string[] = []

    for (const candidate of ownedPaths) {
      const absolute = path.resolve(root, candidate)
      const relative = path.relative(root, absolute)
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue
      const normalized = relative.replace(/\\/g, '/')
      const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized
      if (!seen.has(key)) {
        seen.add(key)
        relativePaths.push(normalized)
      }
    }
    return relativePaths.sort()
  }

  previewCommit(cwd: string, ownedPaths: readonly string[]): GitCommitPreview {
    const paths = this.normalizeOwnedPaths(cwd, ownedPaths)
    if (paths.length === 0) throw new Error('No run-owned paths are available to commit.')

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-git-index-'))
    const indexPath = path.join(tempDir, 'index')
    const env = { ...process.env, GIT_INDEX_FILE: indexPath }
    try {
      try {
        execFileSync('git', ['read-tree', 'HEAD'], { cwd, env, encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] })
      } catch {
        execFileSync('git', ['read-tree', '--empty'], { cwd, env, encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] })
      }
      execFileSync('git', ['add', '--', ...paths], { cwd, env, encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] })
      const diffText = execFileSync('git', ['diff', '--cached', '--binary', '--no-ext-diff', '--', ...paths], {
        cwd,
        env,
        encoding: 'utf-8',
        timeout: 15000,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      if (!diffText.trim()) throw new Error('Run-owned paths contain no changes to commit.')
      return { paths, diffText, diffHash: createHash('sha256').update(diffText).digest('hex') }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }

  commit(cwd: string, message: string, ownedPaths: readonly string[], expectedDiffHash: string): string {
    const preview = this.previewCommit(cwd, ownedPaths)
    if (!expectedDiffHash || preview.diffHash !== expectedDiffHash) {
      throw new Error('Run-owned changes changed after approval; review the updated diff before committing.')
    }

    execFileSync('git', ['add', '--', ...preview.paths], { cwd, encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] })
    const stagedDiff = execFileSync('git', ['diff', '--cached', '--binary', '--no-ext-diff', '--', ...preview.paths], {
      cwd,
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stagedHash = createHash('sha256').update(stagedDiff).digest('hex')
    if (stagedHash !== expectedDiffHash) {
      throw new Error('Staged changes differ from the approved diff; commit aborted.')
    }
    return execFileSync('git', ['commit', '--only', '-m', message, '--', ...preview.paths], {
      cwd,
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
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
