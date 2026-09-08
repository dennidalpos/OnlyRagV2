import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { collectProjectPlanningFacts } from './projectPlanningFacts'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })))

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-planning-facts-'))
  roots.push(root)
  return root
}

describe('collectProjectPlanningFacts', () => {
  it('collects stack, relevant files, checks and previous decisions', () => {
    const root = workspace()
    fs.mkdirSync(path.join(root, 'src'))
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      scripts: { test: 'vitest run' },
      devDependencies: { typescript: '^5.0.0', vitest: '^4.0.0' },
    }))
    fs.writeFileSync(path.join(root, 'src', 'Dashboard.ts'), 'export function Dashboard() {}')
    fs.writeFileSync(path.join(root, 'src', 'Other.ts'), 'export function Other() {}')

    const result = collectProjectPlanningFacts(root, 'Fix Dashboard', [
      { questionId: 'q1', questionText: 'Storage', selectedOption: 'Local', provenance: 'explicit' },
    ])

    expect(result.facts.workspace).toBe('existing')
    expect(result.facts.stack).toMatchObject({ languages: ['typescript'], testFrameworks: ['vitest'] })
    expect(result.facts.relevantFiles[0]).toBe('src/Dashboard.ts')
    expect(result.facts.verificationCommands).toContain('npm run test')
    expect(result.facts.previousDecisions[0]).toMatchObject({ question: 'Storage', answer: 'Local' })
  })

  it('re-discovers facts after the workspace changes', () => {
    const root = workspace()
    expect(collectProjectPlanningFacts(root, 'Create app').facts.workspace).toBe('empty')
    fs.writeFileSync(path.join(root, 'pyproject.toml'), '[project]\nname = "demo"')
    expect(collectProjectPlanningFacts(root, 'Create app').facts).toMatchObject({
      workspace: 'existing',
      stack: { languages: ['python'] },
    })
  })
})
