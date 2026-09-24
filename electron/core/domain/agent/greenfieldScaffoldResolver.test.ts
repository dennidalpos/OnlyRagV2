import { describe, expect, it } from 'vitest'
import { resolveGreenfieldScaffold } from './greenfieldScaffoldResolver'

const paths = (prompt: string) => resolveGreenfieldScaffold(true, prompt).scaffold.requirements.map((item) => item.path)

describe('resolveGreenfieldScaffold', () => {
  it('derives the minimal accepted web stack without assuming TypeScript', () => {
    expect(paths('Create a React web app')).toEqual(['package.json', 'index.html', 'src/main.jsx', 'src/App.test.jsx'])
    expect(paths('Create a React TypeScript web app')).toEqual(['package.json', 'tsconfig.json', 'index.html', 'src/main.tsx', 'src/App.test.tsx'])
  })

  it('keeps Python, Rust and non-web JavaScript free of web entrypoints', () => {
    expect(paths('Create a Python CLI')).toEqual(['pyproject.toml', 'src/main.py'])
    expect(paths('Create a Rust CLI')).toEqual(['Cargo.toml', 'src/main.rs'])
    expect(paths('Create a Node.js CLI')).toEqual(['package.json', 'src/index.js', 'src/index.test.js'])
  })

  it('ends a JavaScript/TypeScript plan with a behavioral smoke test run by npm test', () => {
    const result = resolveGreenfieldScaffold(true, 'Create a React web app')
    const smoke = result.scaffold.requirements.at(-1)

    expect(smoke).toMatchObject({ path: 'src/App.test.jsx', placement: 'end', proposedVerificationCommand: 'npm test' })
    expect(smoke?.acceptanceCriteria?.[0]).toMatch(/npm test runs src\/App\.test\.jsx/)
    expect(result.proposedVerificationCommands).toContain('npm test')
  })

  it('uses accepted interview answers and makes future checks non-executable', () => {
    const result = resolveGreenfieldScaffold(true, 'Create the application', [
      {
        questionId: 'stack',
        questionText: 'Stack',
        selectedOption: 'Python',
        provenance: 'accepted_recommendation',
      },
    ])

    expect(result.acceptedStack).toBe('python')
    expect(result.proposedVerificationCommands).toEqual(['python -m compileall src'])
    expect(result.scaffold.requirements[0]).not.toHaveProperty('verificationCommand')
  })

  it('does not invent infrastructure when the stack is unresolved or the project exists', () => {
    expect(paths('Create the application')).toEqual([])
    expect(resolveGreenfieldScaffold(false, 'Create a React app').scaffold.requirements).toEqual([])
    expect(
      resolveGreenfieldScaffold(true, 'Create the application', [
        {
          questionId: 'stack',
          questionText: 'Stack',
          selectedOption: 'React',
          provenance: 'unconfirmed_assumption',
        },
      ]).scaffold.requirements,
    ).toEqual([])
  })
})
