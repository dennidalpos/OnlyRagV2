import { describe, expect, it } from 'vitest'
import { resolveGreenfieldScaffold } from './greenfieldScaffoldResolver'

const paths = (prompt: string) => resolveGreenfieldScaffold(true, prompt).scaffold.requirements.map((item) => item.path)

describe('resolveGreenfieldScaffold', () => {
  it('derives the minimal accepted web stack without assuming TypeScript', () => {
    expect(paths('Create a React web app')).toEqual(['package.json', 'index.html', 'src/main.jsx'])
    expect(paths('Create a React TypeScript web app')).toEqual(['package.json', 'tsconfig.json', 'index.html', 'src/main.tsx'])
  })

  it('keeps Python, Rust and non-web JavaScript free of web entrypoints', () => {
    expect(paths('Create a Python CLI')).toEqual(['pyproject.toml', 'src/main.py'])
    expect(paths('Create a Rust CLI')).toEqual(['Cargo.toml', 'src/main.rs'])
    expect(paths('Create a Node.js CLI')).toEqual(['package.json', 'src/index.js'])
  })

  it('uses accepted interview answers and makes future checks non-executable', () => {
    const result = resolveGreenfieldScaffold(true, 'Create the application', [{
      questionId: 'stack', questionText: 'Stack', selectedOption: 'Python', provenance: 'accepted_recommendation',
    }])

    expect(result.acceptedStack).toBe('python')
    expect(result.proposedVerificationCommands).toEqual(['python -m compileall src'])
    expect(result.scaffold.requirements[0]).not.toHaveProperty('verificationCommand')
  })

  it('does not invent infrastructure when the stack is unresolved or the project exists', () => {
    expect(paths('Create the application')).toEqual([])
    expect(resolveGreenfieldScaffold(false, 'Create a React app').scaffold.requirements).toEqual([])
    expect(resolveGreenfieldScaffold(true, 'Create the application', [{
      questionId: 'stack', questionText: 'Stack', selectedOption: 'React', provenance: 'unconfirmed_assumption',
    }]).scaffold.requirements).toEqual([])
  })
})
