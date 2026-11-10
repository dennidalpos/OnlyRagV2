import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
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
const SCRIPT_MODULE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.mts', '.cjs', '.cts']

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
      if (entry.name === '.onlyrag' || DEFAULT_IGNORED_DIRS.has(entry.name)) continue
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

    const extension = path.extname(relativePath).toLowerCase()
    if (SCRIPT_MODULE_EXTENSIONS.includes(extension)) {
      const stem = relativePath.slice(0, -extension.length)
      const aliases = SCRIPT_MODULE_EXTENSIONS.filter((candidate) => candidate !== extension)
        .map((candidate) => inspect(path.resolve(root, stem + candidate)))
        .filter((result) => result.exists)
      if (aliases.length === 1) return aliases[0]
    }

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

/** Bounded version of workspace files, excluding generated and agent-owned trees. */
export function captureWorkspaceVersion(workspacePath: string): string | undefined {
  const root = path.resolve(workspacePath)
  const hash = createHash('sha256')
  let visited = 0
  const visit = (directory: string): boolean => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      return false
    }
    for (const entry of entries) {
      if (entry.name === '.onlyrag' || DEFAULT_IGNORED_DIRS.has(entry.name)) continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!visit(absolute)) return false
      } else if (entry.isFile()) {
        if (++visited > 10_000) return false
        try {
          const stat = fs.statSync(absolute)
          hash.update(`${path.relative(root, absolute).replace(/\\/g, '/')}\0${stat.size}\0${stat.mtimeMs}\n`)
        } catch {
          return false
        }
      }
    }
    return true
  }
  return visit(root) ? hash.digest('hex') : undefined
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
