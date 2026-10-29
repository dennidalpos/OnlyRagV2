import fs from 'node:fs'
import path from 'node:path'
import { isIgnoredPath } from '../../domain/agent/contextFilter'

/** Guards against a walk of a workspace that turns out to be a huge tree. */
const MAX_SCANNED_ENTRIES = 20000

export interface CommandTouchedFilesScan {
  /** Workspace-relative, forward-slash paths, sorted for deterministic output. */
  files: string[]
  /** True when the walk hit MAX_SCANNED_ENTRIES and the file list may be incomplete. */
  truncated: boolean
  /** Top-level directories the command created inside the workspace root. */
  createdTopLevelDirs: string[]
}

/** Lists top-level directories created at or after `startedAtMs`. */
function findCreatedTopLevelDirs(root: string, thresholdMs: number): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }

  const created: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || isIgnoredPath(entry.name, true)) continue
    try {
      if (fs.statSync(path.join(root, entry.name)).birthtimeMs >= thresholdMs) created.push(entry.name)
    } catch {
      // Vanished between readdir and stat: nothing to report.
    }
  }
  return created.sort()
}

/** Returns the files under `workspacePath` modified at or after `startedAtMs`. */
export function scanCommandTouchedFiles(workspacePath: string, startedAtMs: number, maxEntries: number = MAX_SCANNED_ENTRIES): CommandTouchedFilesScan {
  const root = path.resolve(workspacePath)
  const threshold = startedAtMs - 1000
  const files: string[] = []
  let scanned = 0
  let truncated = false

  const walk = (dir: string) => {
    if (truncated) return

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (truncated) return
      const isDirectory = entry.isDirectory()
      // isIgnoredPath is the canonical filter: it also drops dot-directories, which matters here because the agent's own .onlyrag session state is rewritten on every checkpoint and would otherwise be attributed to the user's command on every single scan.
      if (isIgnoredPath(entry.name, isDirectory)) continue

      const absolute = path.join(dir, entry.name)
      if (isDirectory) {
        walk(absolute)
        continue
      }
      if (!entry.isFile()) continue

      if (++scanned > maxEntries) {
        truncated = true
        return
      }

      try {
        if (fs.statSync(absolute).mtimeMs >= threshold) {
          files.push(path.relative(root, absolute).replace(/\\/g, '/'))
        }
      } catch {
        // A file removed between readdir and stat simply isn't reportable.
      }
    }
  }

  walk(root)
  return {
    files: files.sort(),
    truncated,
    createdTopLevelDirs: findCreatedTopLevelDirs(root, threshold),
  }
}
