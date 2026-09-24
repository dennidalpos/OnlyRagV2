import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_IGNORED_DIRS } from '../../domain/agent/contextFilter'
import { resolveDeclaredFilePaths, type DeliverableProbe, type DeliverableProbeResult } from '../../../../shared/domain/agent/milestoneDeliverableResolver'
import type { PlanMilestone } from '../../../../shared/domain/agent/planMilestone'
import { contentVersion } from './fileContentVersion'

const MISSING: DeliverableProbeResult = { exists: false, contentLength: 0 }

/** Max byte size to inspect for placeholder detection. */
const MAX_INSPECTABLE_BYTES = 4096

/** Indexing limits for shallow deliverable resolution. */
const MAX_INDEXED_FILES = 400
const MAX_INDEX_DEPTH = 6

/** Indexes workspace files by basename, prioritizing shortest relative paths. */
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
      // Shortest path wins
      if (!existing || candidate.split(path.sep).length < existing.split(path.sep).length) {
        index.set(entry.name, candidate)
      }
    }
  }

  walk(root, 0)
  return index
}

/** Builds a probe rooted at `workspacePath`. */
function buildWorkspaceDeliverableProbe(workspacePath: string, includeHash: boolean): DeliverableProbe {
  const root = path.resolve(workspacePath)
  let basenameIndex: Map<string, string> | null = null

  const inspect = (resolved: string): DeliverableProbeResult => {
    try {
      const stats = fs.statSync(resolved)
      if (!stats.isFile()) return MISSING
      const shouldRead = includeHash || (stats.size > 0 && stats.size <= MAX_INSPECTABLE_BYTES)
      if (!shouldRead) return { exists: true, contentLength: stats.size }
      const body = fs.readFileSync(resolved, 'utf-8')
      return {
        exists: true,
        contentLength: stats.size,
        ...(stats.size <= MAX_INSPECTABLE_BYTES ? { content: body } : {}),
        ...(includeHash ? { contentHash: contentVersion(body) } : {}),
      }
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

    // Bare filenames without directory paths fall back to shortest-path basename search
    // to match deliverables located in subdirectories (e.g. globals.css -> src/styles/globals.css).
    if (relativePath.includes('/') || relativePath.includes(path.sep)) return MISSING

    basenameIndex = basenameIndex ?? buildBasenameIndex(root)
    const found = basenameIndex.get(relativePath)
    return found ? inspect(path.resolve(root, found)) : MISSING
  }
}

export function createWorkspaceDeliverableProbe(workspacePath: string): DeliverableProbe {
  return buildWorkspaceDeliverableProbe(workspacePath, false)
}

export function captureMilestoneFileEvidence(workspacePath: string, milestone: Pick<PlanMilestone, 'title' | 'filePaths'>): Record<string, string> | undefined {
  const deliverables = resolveDeclaredFilePaths(milestone)
  if (deliverables.length === 0) return undefined

  const probe = buildWorkspaceDeliverableProbe(workspacePath, true)
  const evidence: Record<string, string> = {}
  for (const deliverable of deliverables) {
    const result = probe(deliverable)
    if (!result.exists || !result.contentHash) return undefined
    evidence[deliverable] = result.contentHash
  }
  return evidence
}
