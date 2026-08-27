import { describe, expect, it } from 'vitest'
import { classifyProjectProfile, projectProfileSchema } from './projectProfileContract'

const project = (id: string) => ({
  id,
  relativePath: id === 'root' ? '.' : `packages/${id}`,
  rootPath: `D:/workspace/${id}`,
  manifestFiles: id === 'root' ? ['package.json'] : [],
  lockfiles: [],
  toolchain: { languages: [], packageManagers: [], testFrameworks: [], buildTools: [], declaredScripts: [] },
  verificationCommands: [],
})

describe('ProjectProfile contract', () => {
  it('classifies empty, existing, monorepo and multi-project workspaces', () => {
    expect(classifyProjectProfile({ projectCount: 0, isMonorepo: false })).toBe('empty')
    expect(classifyProjectProfile({ projectCount: 1, isMonorepo: false })).toBe('existing')
    expect(classifyProjectProfile({ projectCount: 2, isMonorepo: true })).toBe('monorepo')
    expect(classifyProjectProfile({ projectCount: 2, isMonorepo: false })).toBe('multi-project')
  })

  it('accepts valid profiles and enforces project-count invariants', () => {
    expect(projectProfileSchema.parse({
      schemaVersion: 1,
      workspaceRoot: 'D:/workspace',
      classification: 'monorepo',
      projects: [project('root'), project('web')],
    }).classification).toBe('monorepo')

    expect(() => projectProfileSchema.parse({
      schemaVersion: 1,
      workspaceRoot: 'D:/workspace',
      classification: 'empty',
      projects: [project('root')],
    })).toThrow()
  })

  it('rejects malformed profiles and invalid classification input', () => {
    expect(() => classifyProjectProfile({ projectCount: -1, isMonorepo: false })).toThrow()
    expect(() => projectProfileSchema.parse({
      schemaVersion: 1,
      workspaceRoot: 'D:/workspace',
      classification: 'existing',
      projects: [],
      unexpected: true,
    })).toThrow()
  })
})
