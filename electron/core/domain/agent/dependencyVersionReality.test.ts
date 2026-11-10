import { describe, it, expect } from 'vitest'
import { declaredDependencies, majorOf, findVersionReality, buildVersionRealityNote, pendingManifestAdvice } from './dependencyVersionReality'
import { ORDER_MARKER } from './diagnosticAdvice'

/** The manifest run 10 of 2026-08-25 wrote, which took that session to 0/12. */
const RUN_10_MANIFEST = {
  dependencies: { react: '^18.2.0', '@tailwindcss/react': '^1.0.0' },
  devDependencies: { typescript: '^4.7.3', vite: '^4.0.0' },
}

describe('declaredDependencies', () => {
  it('reads both dependency blocks', () => {
    expect(
      declaredDependencies(RUN_10_MANIFEST)
        .map((d) => d.name)
        .sort(),
    ).toEqual(['@tailwindcss/react', 'react', 'typescript', 'vite'])
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

  it('reports declared ranges that match no published version', () => {
    const findings = findVersionReality(
      [{ name: 'react-dom', range: '^19.8.0' }],
      [{ name: 'react-dom', exists: true, latest: '19.2.0', versions: ['19.1.0', '19.2.0'] }],
    )

    expect(findings.unpublished).toEqual([{ name: 'react-dom', declared: '^19.8.0', latest: '19.2.0' }])
  })

  it('never reports a package the registry could not be reached about', () => {
    // An unreachable network answers exists:true with no version. Reporting "does not exist"
    // there would send the agent deleting a correct dependency.
    const findings = findVersionReality(declared, [{ name: 'typescript', exists: true }])

    expect(findings.nonexistent).toEqual([])
    expect(findings.outdated).toEqual([])
  })
})

describe('buildVersionRealityNote', () => {
  it('deals with the invented package first, since no install can succeed while it is declared', () => {
    const directive = buildVersionRealityNote({
      nonexistent: ['@tailwindcss/react'],
      unpublished: [],
      outdated: [{ name: 'typescript', declared: '^4.7.3', latest: '5.9.2' }],
    })!

    expect(directive).toContain('DO NOT EXIST ON NPM')
    expect(directive).toContain('@tailwindcss/react')
    // One instruction for now: the stale version is not also ordered in the same message.
    expect(directive).not.toContain('5.9.2')
  })

  it('gives the real version number, because the model cannot know it', () => {
    const directive = buildVersionRealityNote({
      nonexistent: [],
      unpublished: [],
      outdated: [{ name: 'typescript', declared: '^4.7.3', latest: '5.9.2' }],
    })!

    expect(directive).toContain('you declared ^4.7.3, npm currently publishes 5.9.2')
    expect(directive).toContain('Consider updating that range in package.json')
  })

  it('says nothing when the manifest matches reality', () => {
    expect(buildVersionRealityNote({ nonexistent: [], unpublished: [], outdated: [] })).toBeNull()
  })

  it('replaces an unpublished manifest range before install', () => {
    const directive = buildVersionRealityNote({
      nonexistent: [],
      unpublished: [{ name: 'react-dom', declared: '^19.8.0', latest: '19.2.0' }],
      outdated: [],
    })!

    expect(directive).toContain('MATCH NO PUBLISHED RELEASE')
    expect(directive).toContain('write_file')
    expect(directive).toContain('19.2.0')
    expect(directive).toContain('Do NOT run an install first')
  })
})

describe('one instruction per message', () => {
  // Run 14 of 2026-08-25: the directive ended with "Then install again", and the model ran `npm install` repeatedly until the loop guard aborted the session at step 21, 0/12, with package.json never rewritten.
  it('keeps an outdated major advisory, since an old major still installs', () => {
    const outdated = buildVersionRealityNote({
      nonexistent: [],
      unpublished: [],
      outdated: [{ name: 'typescript', declared: '^4.7.3', latest: '5.9.2' }],
    })!

    // An order here contradicted the arbiter's install directive in the 2026-09-25 qwen3.8 run.
    expect(outdated).not.toMatch(/MUST|Do NOT/)
  })

  it('never orders a source edit alongside removing an invented package', () => {
    const missing = buildVersionRealityNote({ nonexistent: ['@tailwindcss/react'], unpublished: [], outdated: [] })!

    expect(missing).toContain('Do NOT try to install')
    expect(missing.match(/Next tool call:/g)).toHaveLength(1)
    // A tool result advises; only the arbiter orders.
    expect(missing).not.toMatch(ORDER_MARKER)
  })
})

describe('packages whose major bump rewrites the configuration', () => {
  it('never pushes typescript, tailwindcss or eslint to a new major', () => {
    // Runs 12 and 18 of 2026-08-25 took typescript to 7 on this directive's advice and then died in tsconfig.json (TS5108, TS5102): the model writes the config it learned, which predates the compiler it was just told to install.
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
      ],
    )

    expect(findings.outdated).toEqual([])
  })

  it('still reports a runtime library, where the version is the whole change', () => {
    const findings = findVersionReality([{ name: 'react', range: '^18.2.0' }], [{ name: 'react', exists: true, latest: '19.2.0' }])

    expect(findings.outdated).toEqual([{ name: 'react', declared: '^18.2.0', latest: '19.2.0' }])
  })

  it('still reports a non-existent package even when it is a build tool', () => {
    const findings = findVersionReality([{ name: 'typescript', range: '^5.0.0' }], [{ name: 'typescript', exists: false }])

    expect(findings.nonexistent).toEqual(['typescript'])
  })
})

describe('pendingManifestAdvice', () => {
  const output = [
    'npm error code ETARGET',
    '',
    buildVersionRealityNote({ nonexistent: [], unpublished: [{ name: 'react', declared: '^19.8.0', latest: '19.3.0' }], outdated: [] })!.trim(),
    '',
    'A vague clarification question to the user will not help here: the diagnostics above name the fix.',
  ].join('\n')

  it('reads back the advised rewrite, without the text around it, while nothing has written package.json since', () => {
    const advice = pendingManifestAdvice([{ step: 4, output }], [{ step: 4, tool: 'run_command', target: 'npm install', status: 'FAILURE' }])

    expect(advice?.heading).toBe('[THESE VERSION RANGES MATCH NO PUBLISHED RELEASE]')
    expect(advice?.facts[0]).toBe('- react: you declared ^19.8.0, npm currently publishes 19.3.0')
    expect(advice?.nextCall).toContain('"write_file" on "package.json"')
    expect(advice?.constraints).toEqual(['Do NOT run an install first and do NOT guess another version.'])
  })

  it('counts the order as answered once package.json is written successfully afterwards', () => {
    const episodes = [
      { step: 4, tool: 'run_command', target: 'npm install', status: 'FAILURE' as const },
      { step: 5, tool: 'write_file', target: 'C:\\ws\\package.json', status: 'SUCCESS' as const },
    ]

    expect(pendingManifestAdvice([{ step: 4, output }], episodes)).toBeNull()
  })

  it('ignores advisory output such as an outdated major', () => {
    expect(pendingManifestAdvice([{ step: 2, output: '[THESE VERSIONS ARE MAJOR RELEASES BEHIND — THE REGISTRY WAS ASKED]' }], [])).toBeNull()
  })
})
