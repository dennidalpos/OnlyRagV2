import { describe, it, expect } from 'vitest'
import {
  declaredDependencies,
  majorOf,
  findVersionReality,
  buildVersionRealityDirective,
} from './dependencyVersionReality'

/** The manifest run 10 of 2026-08-25 wrote, which took that session to 0/12. */
const RUN_10_MANIFEST = {
  dependencies: { react: '^18.2.0', '@tailwindcss/react': '^1.0.0' },
  devDependencies: { typescript: '^4.7.3', vite: '^4.0.0' },
}

describe('declaredDependencies', () => {
  it('reads both dependency blocks', () => {
    expect(declaredDependencies(RUN_10_MANIFEST).map((d) => d.name).sort()).toEqual([
      '@tailwindcss/react',
      'react',
      'typescript',
      'vite',
    ])
  })

  it('survives a manifest that declares nothing', () => {
    expect(declaredDependencies({})).toEqual([])
    expect(declaredDependencies(null)).toEqual([])
  })
})

describe('majorOf', () => {
  it('ignores range operators', () => {
    expect(majorOf('^4.7.3')).toBe(4)
    expect(majorOf('~18.2.0')).toBe(18)
    expect(majorOf('>=7.0.0')).toBe(7)
    expect(majorOf('')).toBeNull()
  })
})

describe('findVersionReality', () => {
  const declared = declaredDependencies(RUN_10_MANIFEST)

  it('separates a package that does not exist from one that is merely old', () => {
    const findings = findVersionReality(declared, [
      { name: '@tailwindcss/react', exists: false },
      { name: 'typescript', exists: true, latest: '5.9.2' },
      { name: 'react', exists: true, latest: '19.2.0' },
      { name: 'vite', exists: true, latest: '4.5.14' },
    ])

    expect(findings.nonexistent).toEqual(['@tailwindcss/react'])
    // typescript is excluded on purpose — its major bump rewrites tsconfig.json, which the
    // model cannot do for a release it has never seen. See the dedicated describe below.
    expect(findings.outdated.map((o) => o.name).sort()).toEqual(['react'])
    // vite is on the same major as what npm publishes: not worth a turn.
    expect(findings.outdated.some((o) => o.name === 'vite')).toBe(false)
  })

  it('never reports a package the registry could not be reached about', () => {
    // An unreachable network answers exists:true with no version. Reporting "does not exist"
    // there would send the agent deleting a correct dependency.
    const findings = findVersionReality(declared, [{ name: 'typescript', exists: true }])

    expect(findings.nonexistent).toEqual([])
    expect(findings.outdated).toEqual([])
  })
})

describe('buildVersionRealityDirective', () => {
  it('deals with the invented package first, since no install can succeed while it is declared', () => {
    const directive = buildVersionRealityDirective({
      nonexistent: ['@tailwindcss/react'],
      outdated: [{ name: 'typescript', declared: '^4.7.3', latest: '5.9.2' }],
    })!

    expect(directive).toContain('DO NOT EXIST ON NPM')
    expect(directive).toContain('@tailwindcss/react')
    // One instruction for now: the stale version is not also ordered in the same message.
    expect(directive).not.toContain('5.9.2')
  })

  it('gives the real version number, because the model cannot know it', () => {
    const directive = buildVersionRealityDirective({
      nonexistent: [],
      outdated: [{ name: 'typescript', declared: '^4.7.3', latest: '5.9.2' }],
    })!

    expect(directive).toContain('you declared ^4.7.3, npm currently publishes 5.9.2')
    expect(directive).toContain('"write_file" on "package.json"')
  })

  it('says nothing when the manifest matches reality', () => {
    expect(buildVersionRealityDirective({ nonexistent: [], outdated: [] })).toBeNull()
  })
})

describe('one instruction per message', () => {
  // Run 14 of 2026-08-25: the directive ended with "Then install again", and the model ran
  // `npm install` repeatedly until the loop guard aborted the session at step 21, 0/12, with
  // package.json never rewritten. The re-install is a consequence, never a second action.
  it('never orders an install alongside the manifest rewrite', () => {
    const outdated = buildVersionRealityDirective({
      nonexistent: [],
      outdated: [{ name: 'typescript', declared: '^4.7.3', latest: '5.9.2' }],
    })!

    expect(outdated).toContain('Do NOT run an install first')
    expect(outdated).not.toMatch(/Then install/i)
  })

  it('never orders a source edit alongside removing an invented package', () => {
    const missing = buildVersionRealityDirective({ nonexistent: ['@tailwindcss/react'], outdated: [] })!

    expect(missing).toContain('Do NOT try to install')
    expect(missing.match(/MUST be/g)).toHaveLength(1)
  })
})

describe('packages whose major bump rewrites the configuration', () => {
  it('never pushes typescript, tailwindcss or eslint to a new major', () => {
    // Runs 12 and 18 of 2026-08-25 took typescript to 7 on this directive's advice and then died
    // in tsconfig.json (TS5108, TS5102): the model writes the config it learned, which predates
    // the compiler it was just told to install. Run 18 rewrote tsconfig.json 17 times, 1/14.
    const findings = findVersionReality(
      [
        { name: 'typescript', range: '^5.0.0' },
        { name: 'tailwindcss', range: '^3.0.0' },
        { name: 'eslint', range: '^8.0.0' },
      ],
      [
        { name: 'typescript', exists: true, latest: '7.0.2' },
        { name: 'tailwindcss', exists: true, latest: '4.3.3' },
        { name: 'eslint', exists: true, latest: '10.9.1' },
      ]
    )

    expect(findings.outdated).toEqual([])
  })

  it('still reports a runtime library, where the version is the whole change', () => {
    const findings = findVersionReality(
      [{ name: 'react', range: '^18.2.0' }],
      [{ name: 'react', exists: true, latest: '19.2.0' }]
    )

    expect(findings.outdated).toEqual([{ name: 'react', declared: '^18.2.0', latest: '19.2.0' }])
  })

  it('still reports a non-existent package even when it is a build tool', () => {
    const findings = findVersionReality(
      [{ name: 'typescript', range: '^5.0.0' }],
      [{ name: 'typescript', exists: false }]
    )

    expect(findings.nonexistent).toEqual(['typescript'])
  })
})
