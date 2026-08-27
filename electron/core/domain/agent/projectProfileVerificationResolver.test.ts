import { describe, expect, it } from 'vitest'
import { resolvePrimaryProfileVerificationTargets, resolveProfileVerificationTargets } from './projectProfileVerificationResolver'
import type { ProjectProfile } from './projectProfileContract'

const profile: ProjectProfile = {
  schemaVersion: 1,
  workspaceRoot: 'D:/workspace',
  classification: 'multi-project',
  projects: [
    {
      id: 'web', relativePath: 'web', rootPath: 'D:/workspace/web', manifestFiles: ['package.json'], lockfiles: [],
      toolchain: { languages: ['typescript'], packageManagers: ['npm'], testFrameworks: [], buildTools: ['vite'], declaredScripts: ['build'] },
      verificationCommands: [{ kind: 'build', command: 'npm run build', coverage: 'entry-reachable', source: 'package.json script "build"' }],
    },
    {
      id: 'api', relativePath: 'api', rootPath: 'D:/workspace/api', manifestFiles: ['package.json'], lockfiles: [],
      toolchain: { languages: ['typescript'], packageManagers: ['npm'], testFrameworks: ['vitest'], buildTools: [], declaredScripts: ['test'] },
      verificationCommands: [{ kind: 'test', command: 'npm run test', coverage: 'whole-project', source: 'package.json script "test"' }],
    },
  ],
}

describe('project profile verification resolver', () => {
  it('keeps every command bound to its project root', () => {
    const targets = resolveProfileVerificationTargets(profile)
    expect(targets.map(({ projectId, projectRootPath, command }) => ({ projectId, projectRootPath, command }))).toEqual([
      { projectId: 'web', projectRootPath: 'D:/workspace/web', command: 'npm run build' },
      { projectId: 'api', projectRootPath: 'D:/workspace/api', command: 'npm run test' },
    ])
    expect(targets.every((target) => target.projectRootPath !== profile.workspaceRoot)).toBe(true)
  })

  it('selects one strongest check per project', () => {
    expect(resolvePrimaryProfileVerificationTargets(profile).map((target) => target.projectId)).toEqual(['web', 'api'])
  })
})
