/**
 * Infrastructure adapter for the domain's `DeliverableProbe` port
 * (see domain/agent/milestoneDeliverableResolver.ts).
 *
 * Answers "does this workspace-relative path exist, and is what it holds a real deliverable
 * or a placeholder?". `statSync` settles existence and size; the body is read back only when
 * the file is small enough to plausibly be a stub, so probing a plan with dozens of entries
 * still costs nothing measurable on real implementation files.
 */

import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_IGNORED_DIRS } from '../../domain/agent/contextFilter'
import type { DeliverableProbe, DeliverableProbeResult } from '../../domain/agent/milestoneDeliverableResolver'

const MISSING: DeliverableProbeResult = { exists: false, contentLength: 0 }

/**
 * Files above this are never inspected: no placeholder runs to four kilobytes, and reading
 * every large deliverable on every probe is exactly the cost this adapter was built to avoid.
 */
const MAX_INSPECTABLE_BYTES = 4096

/** Bounded like every other per-turn walk in this loop; a plan's deliverables live shallow. */
const MAX_INDEXED_FILES = 400
const MAX_INDEX_DEPTH = 6

/**
 * Every file in the workspace, indexed by basename, shortest path first.
 *
 * Built only when a bare filename fails to resolve at the root, and only once per probe.
 */
function buildBasenameIndex(root: string): Map<string, string> {
  const index = new Map<string, string>()
  let seen = 0

  const walk = (dir: string, depth: number) => {
    if (depth > MAX_INDEX_DEPTH || seen >= MAX_INDEXED_FILES) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (seen >= MAX_INDEXED_FILES) return
      if (DEFAULT_IGNORED_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      seen++
      const existing = index.get(entry.name)
      const candidate = path.relative(root, full)
      // Shortest path wins, so a file at the root always beats one nested under it.
      if (!existing || candidate.split(path.sep).length < existing.split(path.sep).length) {
        index.set(entry.name, candidate)
      }
    }
  }

  walk(root, 0)
  return index
}

/**
 * Builds a probe rooted at `workspacePath`. Any candidate that resolves outside the
 * workspace is reported missing rather than probed: milestone titles are model-authored
 * text, so a path token in one is untrusted input like any other.
 */
export function createWorkspaceDeliverableProbe(workspacePath: string): DeliverableProbe {
  const root = path.resolve(workspacePath)
  let basenameIndex: Map<string, string> | null = null

  const inspect = (resolved: string): DeliverableProbeResult => {
    try {
      const stats = fs.statSync(resolved)
      if (!stats.isFile()) return MISSING
      if (stats.size === 0 || stats.size > MAX_INSPECTABLE_BYTES) {
        return { exists: true, contentLength: stats.size }
      }
      return { exists: true, contentLength: stats.size, content: fs.readFileSync(resolved, 'utf-8') }
    } catch {
      return MISSING
    }
  }

  return (relativePath: string): DeliverableProbeResult => {
    if (!relativePath) return MISSING

    const resolved = path.resolve(root, relativePath)
    const relativeToRoot = path.relative(root, resolved)
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) return MISSING

    const direct = inspect(resolved)
    if (direct.exists) return direct

    // A deliverable named without a directory is a name, not a location, and resolving it only
    // against the root turned a delivered file into an eternally missing one. Live run of
    // 2026-08-24: milestone m-9 read "Add Tailwind directives to `globals.css`"; the file was
    // written to `src/styles/globals.css` at step 8 with exactly those directives; `update_plan`
    // was refused at step 17 with "Still missing: globals.css", whose own directive says to
    // write the missing file — so the model rewrote the same 58 bytes at steps 18, 19, 35, 36
    // and 43, each one a no-op, each one blocked as a loop. An instruction that cannot be
    // executed, in the same shape this project has now found four times.
    //
    // Scoped to bare filenames on purpose: a deliverable that DOES name a directory
    // (`src/pages/Tasks.tsx`) keeps exact-path semantics, because there the title stated a
    // location and a file elsewhere would not be it.
    //
    // What this deliberately does NOT answer is whether the file is in the right place — a
    // `tailwind.config.js` under `src/styles/` satisfies a milestone that named no directory
    // and still never reaches the bundler. That is a separate check, and it is open in the
    // tracker; a permanently unsatisfiable milestone is the worse of the two failures, and it
    // is the one that was measured.
    if (relativePath.includes('/') || relativePath.includes(path.sep)) return MISSING

    basenameIndex = basenameIndex ?? buildBasenameIndex(root)
    const found = basenameIndex.get(relativePath)
    return found ? inspect(path.resolve(root, found)) : MISSING
  }
}
