import { describe, expect, it } from 'vitest'
import {
  evaluateFileImportIntegrity,
  extractBareImportSpecifiers,
  packageNameOfSpecifier,
} from './importDeclarationGate'

const declared = (names: string[], aliasPrefixes: string[] = []) => ({
  names: new Set(names),
  aliasPrefixes,
})

describe('extractBareImportSpecifiers', () => {
  it('collects packages from every import and export form', () => {
    const source = `
      import React from 'react'
      import type { FC } from 'react'
      import { createRoot } from 'react-dom/client'
      import styled from '@emotion/styled'
      export { Button } from '@mui/material'
      const lazy = await import('recharts')
      const cjs = require('lodash')
      import legacy = require('legacy-pkg')
    `
    // Verbatim specifiers: the alias check downstream needs them as written.
    expect(extractBareImportSpecifiers('src/App.tsx', source)).toEqual([
      'react',
      'react-dom/client',
      '@emotion/styled',
      '@mui/material',
      'recharts',
      'lodash',
      'legacy-pkg',
    ])
  })

  it('ignores relative paths, node builtins, protocol specifiers and subpath imports', () => {
    const source = `
      import App from './App'
      import cfg from '../config/app.json'
      import './styles/globals.css'
      import fs from 'fs'
      import path from 'node:path'
      import internal from '#internal/helpers'
      import remote from 'https://esm.sh/preact'
    `
    expect(extractBareImportSpecifiers('src/main.tsx', source)).toEqual([])
  })

  it('returns nothing for a file type it does not understand', () => {
    expect(extractBareImportSpecifiers('src/styles.css', "@import 'tailwindcss';")).toEqual([])
    expect(extractBareImportSpecifiers('README.md', "import x from 'react'")).toEqual([])
  })

  it('reduces a deep specifier to the package that must be installed', () => {
    expect(packageNameOfSpecifier('react-dom/client')).toBe('react-dom')
    expect(packageNameOfSpecifier('@scope/pkg/sub/path')).toBe('@scope/pkg')
    expect(packageNameOfSpecifier('lodash')).toBe('lodash')
  })
})

describe('evaluateFileImportIntegrity', () => {
  it('names the invented packages a written component imports', () => {
    // The three components of session-1787562597025-q8a5. None of these packages exist.
    const source = `
      import React from 'react'
      import { Container } from '@tailwindcss/react'
      import { Row, Col } from 'tailwind-react-components'
    `
    const verdict = evaluateFileImportIntegrity(
      'src/pages/Dashboard.tsx',
      source,
      declared(['react', 'react-dom', 'tailwindcss'])
    )

    expect(verdict.ok).toBe(false)
    expect(verdict.undeclared).toEqual(['@tailwindcss/react', 'tailwind-react-components'])
    expect(verdict.directive).toContain('src/pages/Dashboard.tsx')
    expect(verdict.directive).toContain('@tailwindcss/react')
    expect(verdict.directive).not.toContain('react-dom')
  })

  it('accepts a file whose every import is declared', () => {
    const source = `import React from 'react'\nimport { createRoot } from 'react-dom/client'`
    expect(evaluateFileImportIntegrity('src/main.tsx', source, declared(['react', 'react-dom']))).toEqual({
      ok: true,
      undeclared: [],
    })
  })

  it('treats a tsconfig path alias as declared, not as a missing package', () => {
    const source = `import { Card } from '@/components/Card'\nimport { api } from '~/services/api'`
    const verdict = evaluateFileImportIntegrity('src/pages/Tasks.tsx', source, declared(['react'], ['@/', '~/']))
    expect(verdict.ok).toBe(true)
  })

  it('stays silent when the project declares nothing at all', () => {
    // Too early in a scaffold to accuse anything: every import would be reported.
    const verdict = evaluateFileImportIntegrity('src/App.tsx', `import React from 'react'`, declared([]))
    expect(verdict.ok).toBe(true)
  })

  it('flags a devDependency-only import as declared, since a typecheck resolves it', () => {
    const verdict = evaluateFileImportIntegrity(
      'src/App.test.tsx',
      `import { describe } from 'vitest'`,
      declared(['vitest'])
    )
    expect(verdict.ok).toBe(true)
  })
})
