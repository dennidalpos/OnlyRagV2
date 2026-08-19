import path from 'node:path'
import type { WorkspaceProject } from '../../../../src/types'

/** Basename of a filesystem path, used as the display name for a newly registered project. */
export function deriveNameFromPath(projectPath: string): string {
  const trimmed = projectPath.replace(/[/\\]+$/, '')
  return path.basename(trimmed) || trimmed
}

/**
 * Registers a project: creates it (both timestamps = now) if unseen, or -- when it already
 * exists -- preserves `addedAt` and only bumps `lastOpenedAt`. Reselecting a known project
 * must never make it look freshly added.
 */
export function upsertProject(projects: WorkspaceProject[], projectPath: string, name?: string): WorkspaceProject[] {
  const nowIso = new Date().toISOString()
  const index = projects.findIndex((p) => p.path === projectPath)
  if (index === -1) {
    const entry: WorkspaceProject = { path: projectPath, name: name || deriveNameFromPath(projectPath), addedAt: nowIso, lastOpenedAt: nowIso }
    return [entry, ...projects]
  }
  const next = [...projects]
  next[index] = { ...next[index], name: name || next[index].name, lastOpenedAt: nowIso }
  return next
}

/** Bumps `lastOpenedAt` for an already-registered project; a no-op list when it isn't known. */
export function touchProject(projects: WorkspaceProject[], projectPath: string): WorkspaceProject[] | null {
  const index = projects.findIndex((p) => p.path === projectPath)
  if (index === -1) return null
  const next = [...projects]
  next[index] = { ...next[index], lastOpenedAt: new Date().toISOString() }
  return next
}

/** Most recently opened project first, falling back to `addedAt` for projects never reopened. */
export function sortProjectsByRecency(projects: WorkspaceProject[]): WorkspaceProject[] {
  return [...projects].sort((a, b) => Date.parse(b.lastOpenedAt || b.addedAt) - Date.parse(a.lastOpenedAt || a.addedAt))
}

/** Merges legacy (localStorage) projects into an existing registry, keeping the registry's entries on conflict. */
export function mergeProjects(existing: WorkspaceProject[], incoming: WorkspaceProject[]): WorkspaceProject[] {
  const existingPaths = new Set(existing.map((p) => p.path))
  const newcomers = incoming.filter((p) => p && typeof p.path === 'string' && p.path && !existingPaths.has(p.path))
  if (newcomers.length === 0) return existing
  return sortProjectsByRecency([...existing, ...newcomers])
}
