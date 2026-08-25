import { describe, it, expect } from 'vitest'
import {
  classifyModuleDiagnostic,
  unresolvedPackages,
  packageOfSpecifier,
  buildModuleResolutionDirective,
} from './moduleResolutionDiagnostic'

/** Verbatim from run 7 of 2026-08-25, where every package named was already installed. */
const RUN_7_OUTPUT = `
src/App.tsx(3,56): error TS2792: Cannot find module 'react-router-dom'. Did you mean to set the 'moduleResolution' option to 'nodenext', or to add aliases to the 'paths' option?
src/components/Button.tsx(3,37): error TS2792: Cannot find module '@mui/material'. Did you mean to set the 'moduleResolution' option to 'nodenext', or to add aliases to the 'paths' option?
src/components/HamburgerMenu.tsx(3,24): error TS2792: Cannot find module 'react-icons/fa'.
`

describe('packageOfSpecifier', () => {
  it('reduces a deep import to the package that provides it', () => {
    expect(packageOfSpecifier('react-icons/fa')).toBe('react-icons')
    expect(packageOfSpecifier('@mui/material/Button')).toBe('@mui/material')
    expect(packageOfSpecifier('@mui/material')).toBe('@mui/material')
  })

  it('ignores relative imports, which belong to no package', () => {
    expect(packageOfSpecifier('./TaskCard')).toBeNull()
    expect(packageOfSpecifier('../components/TaskCard')).toBeNull()
  })
})

describe('unresolvedPackages', () => {
  it('names every package the output could not resolve, once each', () => {
    expect(unresolvedPackages(RUN_7_OUTPUT).sort()).toEqual(['@mui/material', 'react-icons', 'react-router-dom'])
  })

  it('finds nothing in output that reports no module failure', () => {
    expect(unresolvedPackages('src/App.tsx(1,1): error TS1192: has no default export')).toEqual([])
  })
})

describe('classifyModuleDiagnostic', () => {
  const installed = (pkgs: string[]) => (pkg: string) => pkgs.includes(pkg)

  it('calls it a config problem when every package is already on disk', () => {
    // The failure that closed runs 6 and 7 at 0/14: tsconfig carried "module": "ESNext" with no
    // moduleResolution, so tsc fell back to "classic" and never looked in node_modules.
    const cause = classifyModuleDiagnostic(RUN_7_OUTPUT, installed(['react-router-dom', '@mui/material', 'react-icons']))

    expect(cause).toBe('compiler_resolution')
  })

  it('still calls it a missing dependency when one package is genuinely absent', () => {
    // Doubt resolves towards installing: it is the cheap, reversible move, and a resolution
    // problem underneath will still be there to diagnose on the next run.
    const cause = classifyModuleDiagnostic(RUN_7_OUTPUT, installed(['react-router-dom', '@mui/material']))

    expect(cause).toBe('missing_dependency')
  })

  it('says nothing when the output names no module at all', () => {
    expect(classifyModuleDiagnostic('error TS1192: has no default export', () => true)).toBe('none')
  })
})

describe('buildModuleResolutionDirective', () => {
  it('orders the config edit and forbids the reinstall that was already tried nine times', () => {
    const directive = buildModuleResolutionDirective(RUN_7_OUTPUT, ['react-router-dom', '@mui/material'])

    expect(directive).toContain('THE PACKAGE IS INSTALLED — THE COMPILER CANNOT SEE IT')
    expect(directive).toContain('"write_file" on "tsconfig.json"')
    expect(directive).toContain('"moduleResolution": "bundler"')
    expect(directive).toContain('Do NOT run any install command')
    // One instruction, named concretely: the setting and the value, not "configure resolution".
    expect(directive).not.toContain('npm install <package-name>')
  })

  it('does not claim the compiler said so when it did not', () => {
    const directive = buildModuleResolutionDirective("Cannot find module 'left-pad'", ['left-pad'])

    expect(directive).not.toContain('named the cause itself')
    expect(directive).toContain('TypeScript configuration')
  })
})

describe('the directive names one value', () => {
  it('never offers "node", which TypeScript 7 removed', () => {
    // Run 12 of 2026-08-25: the version directive moved the project to typescript@^7.0.2, the
    // model took the "node" fallback this directive used to offer, and the build died on
    // TS5108 "Option 'moduleResolution=node10' has been removed".
    const directive = buildModuleResolutionDirective("Cannot find module 'react'", ['react'])

    expect(directive).toContain('"moduleResolution": "bundler"')
    expect(directive).not.toContain('"node"')
    expect(directive).not.toContain('CommonJS')
  })
})
