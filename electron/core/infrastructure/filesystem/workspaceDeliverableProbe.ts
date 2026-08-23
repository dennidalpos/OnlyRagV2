/**
 * Infrastructure adapter for the domain's `DeliverableProbe` port
 * (see domain/agent/milestoneDeliverableResolver.ts).
 *
 * Answers "does this workspace-relative path exist with content?" without ever reading
 * the file body — `statSync` alone gives both answers, so probing a milestone's
 * deliverables costs nothing measurable even on a plan with dozens of entries.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { DeliverableProbe, DeliverableProbeResult } from '../../domain/agent/milestoneDeliverableResolver'

const MISSING: DeliverableProbeResult = { exists: false, contentLength: 0 }

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
      return { exists: true, contentLength: stats.size }
    } catch {
      return MISSING
    }
  }
}
