import { describe, it, expect } from 'vitest'
import {
  requestedInstallVersions,
  findManifestDowngrades,
  buildInstallDowngradeRefusal,
  type ManifestDowngrade,
} from './installVersionDowngrade'

/** The manifest the `live-full-task` run of 2026-08-25T12:11 was working against. */
const RUN_1211_RANGES = { react: '^18.2.0', 'react-dom': '^18.2.0', 'react-router-dom': '^7.18.2' }

describe('requestedInstallVersions', () => {
  it('reads the specifier off an explicit target', () => {
    expect(requestedInstallVersions('npm install react@^16.8.0')).toEqual([{ name: 'react', spec: '^16.8.0' }])
  })

  it('keeps the scope on a scoped package and strips only the trailing version', () => {
    expect(requestedInstallVersions('npm i -D @vitejs/plugin-react@^4.0.0')).toEqual([
      { name: '@vitejs/plugin-react', spec: '^4.0.0' },
    ])
  })

  it('ignores targets with no version, and commands that name none', () => {
    expect(requestedInstallVersions('npm install react')).toEqual([])
    expect(requestedInstallVersions('npm install')).toEqual([])
    expect(requestedInstallVersions('npm ci')).toEqual([])
    expect(requestedInstallVersions('npm run build')).toEqual([])
  })

  it('reads several targets out of one command, flags aside', () => {
    expect(requestedInstallVersions('npm install --save-dev vite@^8.0.0 typescript@~5.9.2')).toEqual([
      { name: 'vite', spec: '^8.0.0' },
      { name: 'typescript', spec: '~5.9.2' },
    ])
  })
})

describe('findManifestDowngrades', () => {
  it('catches the install that pinned the tree to react@16', () => {
    // The command the ERESOLVE directive produced from npm's own `peer react@"^16.8.0" from
    // use-optimistic@1.0.0`, and which succeeded three times unchallenged.
    const found = findManifestDowngrades(requestedInstallVersions('npm install react@^16.8.0'), RUN_1211_RANGES)
    expect(found).toEqual([
      { name: 'react', requested: '^16.8.0', requestedMajor: 16, declared: '^18.2.0', declaredMajor: 18 },
    ])
  })

  it('leaves an upgrade alone', () => {
    expect(findManifestDowngrades(requestedInstallVersions('npm install react@^19.0.0'), RUN_1211_RANGES)).toEqual([])
  })

  it('leaves a move inside the same major alone', () => {
    // `^18.3.1` -> `^18.2.0` does not break the tree, and churning a turn over it is the
    // busywork findVersionReality already declines to generate.
    expect(findManifestDowngrades(requestedInstallVersions('npm install react@^18.0.0'), RUN_1211_RANGES)).toEqual([])
  })

  it('does not treat the first install of an undeclared package as a downgrade', () => {
    // No prior declaration means no choice of the project's to contradict, whatever the version.
    expect(findManifestDowngrades(requestedInstallVersions('npm install vite@^4.0.0'), RUN_1211_RANGES)).toEqual([])
  })

  it('says nothing about a specifier that carries no major', () => {
    expect(findManifestDowngrades(requestedInstallVersions('npm install react@latest'), RUN_1211_RANGES)).toEqual([])
    expect(findManifestDowngrades(requestedInstallVersions('npm install react@next'), RUN_1211_RANGES)).toEqual([])
  })

  it('applies to config-breaking packages too, unlike the stale-major report', () => {
    // dependencyVersionReality.ts excludes typescript/tailwindcss/eslint from the "you are a
    // major behind" report because ordering an UPGRADE there hands the model a config format it
    // has never seen. Refusing a downgrade moves nothing, so that reasoning does not transfer:
    // typescript@4 under a tsconfig written for 5 is exactly as destructive as react@16.
    const found = findManifestDowngrades(requestedInstallVersions('npm i -D typescript@^4.7.3'), {
      typescript: '^5.9.2',
    })
    expect(found.map((d) => d.name)).toEqual(['typescript'])
  })

  it('reports every downgrading target a multi-package command names', () => {
    const found = findManifestDowngrades(
      requestedInstallVersions('npm install react@^16.8.0 react-dom@^16.8.0'),
      RUN_1211_RANGES
    )
    expect(found.map((d) => d.name)).toEqual(['react', 'react-dom'])
  })
})

describe('buildInstallDowngradeRefusal', () => {
  const downgrade: ManifestDowngrade = {
    name: 'react',
    requested: '^16.8.0',
    requestedMajor: 16,
    declared: '^18.2.0',
    declaredMajor: 18,
  }

  it('names both ranges and the real current version', () => {
    const refusal = buildInstallDowngradeRefusal(downgrade, '19.2.0')
    expect(refusal).toContain('[VERSION DOWNGRADE REFUSED — INSTALL NOT RUN]')
    expect(refusal).toContain('"react": "^18.2.0"')
    expect(refusal).toContain('"^16.8.0"')
    expect(refusal).toContain('npm currently publishes react@19.2.0')
  })

  it('still refuses when the registry could not be reached', () => {
    // The verdict is decided entirely against the manifest, so a dropped connection costs the
    // message one sentence and never the refusal itself.
    const refusal = buildInstallDowngradeRefusal(downgrade)
    expect(refusal).toContain('[VERSION DOWNGRADE REFUSED — INSTALL NOT RUN]')
    expect(refusal).not.toContain('currently publishes')
  })

  it('forbids the escape flags npm itself offers', () => {
    const refusal = buildInstallDowngradeRefusal(downgrade, '19.2.0')
    expect(refusal).toContain('--force')
    expect(refusal).toContain('--legacy-peer-deps')
  })

  it('carries one thing to do, and it is not "install a different version"', () => {
    // §6.2.2: the model arrives here holding an ERESOLVE directive that ordered exactly the
    // refused command. Re-stating the version would leave two live instructions; naming the
    // requirer as the side that does not fit replaces the older one outright.
    const refusal = buildInstallDowngradeRefusal(downgrade, '19.2.0')
    const imperatives = refusal.split('\n').filter((line) => /^\d\./.test(line))
    expect(imperatives).toHaveLength(2)
    expect(imperatives[0]).toMatch(/^1\. Do NOT/)
    expect(imperatives[1]).toContain('replace that package')
  })
})
