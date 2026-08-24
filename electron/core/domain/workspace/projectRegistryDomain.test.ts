import { describe, it, expect } from 'vitest'
import type { WorkspaceProject } from '../../../../src/types'
import { deriveNameFromPath, upsertProject, touchProject, sortProjectsByRecency, mergeProjects, renameProjectInList } from './projectRegistryDomain'

function buildProject(path: string, overrides: Partial<WorkspaceProject> = {}): WorkspaceProject {
  return { path, name: 'proj', addedAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-01-01T00:00:00.000Z', ...overrides }
}

describe('projectRegistryDomain', () => {
  it('deriveNameFromPath returns the basename, tolerating a trailing slash', () => {
    expect(deriveNameFromPath('D:\\Projects\\Alpha')).toBe('Alpha')
    expect(deriveNameFromPath('/home/user/beta/')).toBe('beta')
    expect(deriveNameFromPath('')).toBe('Workspace')
  })

  it('upsertProject ignores empty or whitespace projectPath', () => {
    const list = [buildProject('/repo/a')]
    expect(upsertProject(list, '')).toEqual(list)
    expect(upsertProject(list, '   ')).toEqual(list)
  })

  it('renameProjectInList renames the specified project display name', () => {
    const list = [buildProject('/repo/a', { name: 'Alpha' }), buildProject('/repo/b', { name: 'Beta' })]
    const renamed = renameProjectInList(list, '/repo/a', 'Alpha Pro')
    expect(renamed.find((p) => p.path === '/repo/a')?.name).toBe('Alpha Pro')
    expect(renamed.find((p) => p.path === '/repo/b')?.name).toBe('Beta')
  })

  it('upsertProject creates a new entry with matching addedAt/lastOpenedAt', () => {
    const next = upsertProject([], '/repo/a')
    expect(next).toHaveLength(1)
    expect(next[0].path).toBe('/repo/a')
    expect(next[0].addedAt).toBe(next[0].lastOpenedAt)
  })

  it('upsertProject preserves addedAt and only bumps lastOpenedAt for an existing project', async () => {
    const first = upsertProject([], '/repo/a')
    const originalAddedAt = first[0].addedAt
    await new Promise((r) => setTimeout(r, 5))
    const second = upsertProject(first, '/repo/a')
    expect(second[0].addedAt).toBe(originalAddedAt)
    expect(Date.parse(second[0].lastOpenedAt!)).toBeGreaterThan(Date.parse(originalAddedAt))
  })

  it('touchProject bumps lastOpenedAt for a known project and returns null for an unknown one', async () => {
    const existing = [buildProject('/repo/a', { lastOpenedAt: '2026-01-01T00:00:00.000Z' })]
    await new Promise((r) => setTimeout(r, 5))
    const touched = touchProject(existing, '/repo/a')
    expect(touched).not.toBeNull()
    expect(Date.parse(touched![0].lastOpenedAt!)).toBeGreaterThan(Date.parse('2026-01-01T00:00:00.000Z'))
    expect(touched![0].addedAt).toBe(existing[0].addedAt)

    expect(touchProject(existing, '/repo/unknown')).toBeNull()
  })

  it('sortProjectsByRecency orders most-recently-opened first, falling back to addedAt', () => {
    const projects = [
      buildProject('/repo/old', { addedAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-01-02T00:00:00.000Z' }),
      buildProject('/repo/new', { addedAt: '2026-01-03T00:00:00.000Z', lastOpenedAt: '2026-01-05T00:00:00.000Z' }),
      // Falls back to addedAt (2026-01-04) since it was never reopened -- still newer than "old"'s lastOpenedAt.
      buildProject('/repo/never-reopened', { addedAt: '2026-01-04T00:00:00.000Z', lastOpenedAt: undefined }),
    ]
    const sorted = sortProjectsByRecency(projects)
    expect(sorted.map((p) => p.path)).toEqual(['/repo/new', '/repo/never-reopened', '/repo/old'])
  })

  it('mergeProjects keeps the existing entry on conflict and adds only new paths', () => {
    const existing = [buildProject('/repo/a', { name: 'Existing Name' })]
    const incoming = [buildProject('/repo/a', { name: 'Legacy Name' }), buildProject('/repo/b', { name: 'New' })]
    const merged = mergeProjects(existing, incoming)
    expect(merged).toHaveLength(2)
    expect(merged.find((p) => p.path === '/repo/a')?.name).toBe('Existing Name')
    expect(merged.find((p) => p.path === '/repo/b')?.name).toBe('New')
  })

  it('mergeProjects is a no-op when nothing new is incoming', () => {
    const existing = [buildProject('/repo/a')]
    expect(mergeProjects(existing, [buildProject('/repo/a')])).toBe(existing)
  })
})
