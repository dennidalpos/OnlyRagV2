/**
 * Detects the files a shell command created or rewrote.
 *
 * `changeStats` is produced only by the write_file / replace / delete branches of
 * agentToolExecutorService, so anything a CLI wrote — a scaffolder, a formatter, a codegen
 * step — never reached `sessionChangedFiles`. SESSION_TRACKER.md therefore reported
 * "Modified & Created Files: None" after a successful scaffold, and the next turn's prompt
 * told the agent nothing had been produced.
 *
 * Attribution is by modification time: a file whose mtime is at or after the moment the
 * command started is a file that command touched. This costs one directory walk per shell
 * command and never reads a file body.
 */

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
}

/**
 * Returns the files under `workspacePath` modified at or after `startedAtMs`.
 *
 * Filesystem mtime resolution is coarser than the millisecond clock on some Windows volumes,
 * so the comparison is inclusive with a small tolerance: over-reporting a file the command
 * merely touched is harmless (the tracker lists it), while under-reporting reintroduces the
 * bug this exists to fix.
 */
export function scanCommandTouchedFiles(
  workspacePath: string,
  startedAtMs: number,
  maxEntries: number = MAX_SCANNED_ENTRIES
): CommandTouchedFilesScan {
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
      // isIgnoredPath is the canonical filter: it also drops dot-directories, which matters
      // here because the agent's own .onlyrag session state is rewritten on every checkpoint
      // and would otherwise be attributed to the user's command on every single scan.
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
  return { files: files.sort(), truncated }
}
