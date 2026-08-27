import { describe, expect, it, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { discoverProjectProfile } from './projectProfileDiscovery'

describe('project profile discovery', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  })

  it('classifies an empty workspace without inventing a project', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-profile-empty-'))
    roots.push(root)
    expect(discoverProjectProfile(root)).toMatchObject({ classification: 'empty', projects: [] })
  })

  it('keeps a workspace without any manifest classified as empty', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-profile-no-manifest-'))
    roots.push(root)
    fs.mkdirSync(path.join(root, 'src'))
    fs.writeFileSync(path.join(root, 'README.md'), '# not a project manifest')

    expect(discoverProjectProfile(root)).toMatchObject({ classification: 'empty', projects: [] })
  })

  it('discovers root manifest and lockfile for an existing project', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-profile-existing-'))
    roots.push(root)
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"app"}')
    fs.writeFileSync(path.join(root, 'package-lock.json'), '{}')
    const profile = discoverProjectProfile(root)
    expect(profile.classification).toBe('existing')
    expect(profile.projects[0]).toMatchObject({ relativePath: '.', manifestFiles: ['package.json'], lockfiles: ['package-lock.json'] })
  })

  it('discovers languages, package manager, test framework, build tool and scripts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-profile-toolchain-'))
    roots.push(root)
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      scripts: { test: 'vitest run', build: 'vite build' },
      devDependencies: { typescript: '^5', vitest: '^4', vite: '^8' },
    }))
    fs.writeFileSync(path.join(root, 'package-lock.json'), '{}')
    const toolchain = discoverProjectProfile(root).projects[0].toolchain
    expect(toolchain).toEqual({
      languages: ['typescript'],
      packageManagers: ['npm'],
      testFrameworks: ['vitest'],
      buildTools: ['vite'],
      declaredScripts: ['build', 'test'],
    })
    expect(discoverProjectProfile(root).projects[0].verificationCommands).toEqual([
      { kind: 'build', command: 'npm run build', coverage: 'entry-reachable', source: 'package.json script "build"' },
      { kind: 'test', command: 'npm run test', coverage: 'whole-project', source: 'package.json script "test"' },
    ])
  })

  it('records no test command for a project that has no test script or framework', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-profile-no-test-'))
    roots.push(root)
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      scripts: { build: 'vite build' },
      devDependencies: { vite: '^8' },
    }))

    const project = discoverProjectProfile(root).projects[0]
    expect(project.toolchain.testFrameworks).toEqual([])
    expect(project.verificationCommands).toEqual([
      { kind: 'build', command: 'npm run build', coverage: 'entry-reachable', source: 'package.json script "build"' },
    ])
    expect(project.verificationStatus).toBeUndefined()
  })

  it('resolves verification commands independently for each discovered project', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-profile-checks-'))
    roots.push(root)
    fs.mkdirSync(path.join(root, 'web'))
    fs.mkdirSync(path.join(root, 'api'))
    fs.writeFileSync(path.join(root, 'web', 'package.json'), '{"scripts":{"build":"vite build"}}')
    fs.writeFileSync(path.join(root, 'api', 'package.json'), '{"scripts":{"test":"vitest run"}}')

    const projects = discoverProjectProfile(root).projects
    expect(projects.find((project) => project.relativePath === 'web')?.verificationCommands).toEqual([
      { kind: 'build', command: 'npm run build', coverage: 'entry-reachable', source: 'package.json script "build"' },
    ])
    expect(projects.find((project) => project.relativePath === 'api')?.verificationCommands).toEqual([
      { kind: 'test', command: 'npm run test', coverage: 'whole-project', source: 'package.json script "test"' },
    ])
  })

  it('distinguishes a workspace monorepo from independent multi-project roots', () => {
    const monorepo = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-profile-mono-'))
    roots.push(monorepo)
    fs.writeFileSync(path.join(monorepo, 'package.json'), '{"workspaces":["packages/*"]}')
    fs.mkdirSync(path.join(monorepo, 'packages', 'web'), { recursive: true })
    fs.writeFileSync(path.join(monorepo, 'packages', 'web', 'package.json'), '{}')
    expect(discoverProjectProfile(monorepo).classification).toBe('monorepo')

    const multi = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-profile-multi-'))
    roots.push(multi)
    for (const name of ['one', 'two']) {
      fs.mkdirSync(path.join(multi, name))
      fs.writeFileSync(path.join(multi, name, 'package.json'), '{}')
    }
    expect(discoverProjectProfile(multi).classification).toBe('multi-project')
  })
})
