import { describe, it, expect } from 'vitest'
import { evaluateDependencyIntegrity } from './dependencyIntegrityGate'

const WORKSPACE = 'C:\\Users\\Utente\\Desktop\\test_app'

/** Exactly what depcheck reported for the project session o3tx shipped as "fully runnable". */
const O3TX_MISSING = {
  '@vitejs/plugin-react': ['C:\\Users\\Utente\\Desktop\\test_app\\vite.config.ts'],
  'react-router-dom': [
    'C:\\Users\\Utente\\Desktop\\test_app\\src\\App.tsx',
    'C:\\Users\\Utente\\Desktop\\test_app\\src\\pages\\Tasks.tsx',
  ],
  '@mui/material': [
    'C:\\Users\\Utente\\Desktop\\test_app\\src\\pages\\Dashboard.tsx',
    'C:\\Users\\Utente\\Desktop\\test_app\\src\\components\\Sidebar.tsx',
    'C:\\Users\\Utente\\Desktop\\test_app\\src\\components\\TaskCard.tsx',
  ],
}

describe('evaluateDependencyIntegrity', () => {
  it('passes a project whose imports are all declared', () => {
    expect(evaluateDependencyIntegrity({}, WORKSPACE)).toEqual({ ok: true, missing: [] })
  })

  it('fails the real o3tx project and names every undeclared package', () => {
    const verdict = evaluateDependencyIntegrity(O3TX_MISSING, WORKSPACE)
    expect(verdict.ok).toBe(false)
    expect(verdict.missing.map((m) => m.packageName)).toEqual([
      '@mui/material',
      '@vitejs/plugin-react',
      'react-router-dom',
    ])
  })

  it('reports importing files as workspace-relative forward-slash paths', () => {
    const verdict = evaluateDependencyIntegrity(O3TX_MISSING, WORKSPACE)
    const router = verdict.missing.find((m) => m.packageName === 'react-router-dom')
    expect(router?.importedBy).toEqual(['src/App.tsx', 'src/pages/Tasks.tsx'])
  })

  it('deduplicates a package imported twice from the same file', () => {
    const verdict = evaluateDependencyIntegrity(
      { lodash: [`${WORKSPACE}\\src\\a.ts`, `${WORKSPACE}\\src\\a.ts`] },
      WORKSPACE
    )
    expect(verdict.missing[0].importedBy).toEqual(['src/a.ts'])
  })

  it('ignores type-only packages: a missing @types never breaks a build at runtime', () => {
    const verdict = evaluateDependencyIntegrity({ '@types/node': [`${WORKSPACE}\\src\\a.ts`] }, WORKSPACE)
    expect(verdict).toEqual({ ok: true, missing: [] })
  })

  it('still fails when a real package accompanies a type-only one', () => {
    const verdict = evaluateDependencyIntegrity(
      { '@types/node': [`${WORKSPACE}\\src\\a.ts`], zod: [`${WORKSPACE}\\src\\a.ts`] },
      WORKSPACE
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.missing.map((m) => m.packageName)).toEqual(['zod'])
  })

  it('tells the model what to do, naming the packages and forbidding an early finish', () => {
    const directive = evaluateDependencyIntegrity(O3TX_MISSING, WORKSPACE).directive ?? ''
    expect(directive).toContain('react-router-dom')
    expect(directive).toContain('@mui/material')
    expect(directive).toContain('src/App.tsx')
    expect(directive).toMatch(/do not call finish/i)
  })

  it('leaves a file outside the workspace as an absolute path rather than mangling it', () => {
    const verdict = evaluateDependencyIntegrity({ zod: ['D:\\elsewhere\\x.ts'] }, WORKSPACE)
    expect(verdict.missing[0].importedBy).toEqual(['D:/elsewhere/x.ts'])
  })
})
