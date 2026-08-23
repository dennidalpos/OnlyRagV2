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
import type { DeliverableProbe, DeliverableProbeResult } from '../../domain/agent/milestoneDeliverableResolver'

const MISSING: DeliverableProbeResult = { exists: false, contentLength: 0 }

/**
 * Files above this are never inspected: no placeholder runs to four kilobytes, and reading
 * every large deliverable on every probe is exactly the cost this adapter was built to avoid.
 */
const MAX_INSPECTABLE_BYTES = 4096

/**
 * Builds a probe rooted at `workspacePath`. Any candidate that resolves outside the
 * workspace is reported missing rather than probed: milestone titles are model-authored
 * text, so a path token in one is untrusted input like any other.
 */
export function createWorkspaceDeliverableProbe(workspacePath: string): DeliverableProbe {
  const root = path.resolve(workspacePath)

  return (relativePath: string): DeliverableProbeResult => {
    if (!relativePath) return MISSING

    const resolved = path.resolve(root, relativePath)
    const relativeToRoot = path.relative(root, resolved)
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) return MISSING

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
}
