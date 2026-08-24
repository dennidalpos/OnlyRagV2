import { describe, it, expect } from 'vitest'
import { extractRequestedPackages, packagesWithFailedInstall } from './installCommandParser'
import type { InstallAttemptRecord } from './installCommandParser'

function attempt(target: string, status: InstallAttemptRecord['status'], tool = 'run_command'): InstallAttemptRecord {
  return { tool, target, status }
}

describe('extractRequestedPackages', () => {
  it('reads explicit targets and strips flags', () => {
    expect(extractRequestedPackages('npm install -D tailwindcss postcss')).toEqual([
      { name: 'tailwindcss', hasExplicitVersion: false },
      { name: 'postcss', hasExplicitVersion: false },
    ])
  })

  it('keeps a scope and strips only the trailing version', () => {
    expect(extractRequestedPackages('npm install @vitejs/plugin-react@^6.1.0')).toEqual([
      { name: '@vitejs/plugin-react', hasExplicitVersion: true },
    ])
  })

  it('reports nothing for a bare install, which reinstalls from the lockfile', () => {
    expect(extractRequestedPackages('npm install')).toEqual([])
    expect(extractRequestedPackages('npm ci')).toEqual([])
  })

  it('reports nothing for a command that is not an install', () => {
    expect(extractRequestedPackages('npm run build')).toEqual([])
  })

  it('understands the other package managers', () => {
    expect(extractRequestedPackages('pnpm add react').map((p) => p.name)).toEqual(['react'])
    expect(extractRequestedPackages('yarn add react-dom').map((p) => p.name)).toEqual(['react-dom'])
    expect(extractRequestedPackages('bun i zod').map((p) => p.name)).toEqual(['zod'])
  })
})

describe('packagesWithFailedInstall', () => {
  it('says nothing after a single failure, which is usually a version conflict', () => {
    // The regression this threshold exists for: one failure was read as proof the name could
    // not be installed, and the arbiter spent forty-five steps telling the model to delete
    // `@vitejs/plugin-react` from vite.config.ts — a real package, failed once on ERESOLVE.
    expect(packagesWithFailedInstall([attempt('npm install @vitejs/plugin-react', 'FAILURE')])).toEqual([])
  })

  it('reports a package that failed twice with no success in between', () => {
    // `@tailwindcss/react` does not exist on npm: it fails every single attempt.
    const episodes = [
      attempt('npm install @tailwindcss/react', 'FAILURE'),
      attempt('npm install @tailwindcss/react', 'FAILURE'),
    ]

    expect(packagesWithFailedInstall(episodes)).toEqual(['@tailwindcss/react'])
  })

  it('leaves the ERESOLVE recovery its chance to work', () => {
    // The sequence blueprint §5.3 established and this rule must not break: install fails on a
    // conflict, the directive names the version to move to, the retry succeeds.
    const episodes = [
      attempt('npm install @vitejs/plugin-react', 'FAILURE'),
      attempt('npm install vite@^8.0.0', 'SUCCESS'),
      attempt('npm install @vitejs/plugin-react', 'SUCCESS'),
    ]

    expect(packagesWithFailedInstall(episodes)).toEqual([])
  })

  it('resets the count on a success, even after two earlier failures', () => {
    const episodes = [
      attempt('npm install pkg', 'FAILURE'),
      attempt('npm install pkg', 'FAILURE'),
      attempt('npm install pkg', 'SUCCESS'),
    ]

    // Installed is installed. A later unrelated failure starts counting from scratch.
    expect(packagesWithFailedInstall(episodes)).toEqual([])
  })

  it('does not count loop-guard blocks as failed installs', () => {
    // BLOCKED is the guard refusing to run the command, not the registry refusing the name.
    const episodes = [attempt('npm install some-pkg', 'BLOCKED'), attempt('npm install some-pkg', 'BLOCKED')]

    expect(packagesWithFailedInstall(episodes)).toEqual([])
  })

  it('ignores failures that are not installs', () => {
    expect(packagesWithFailedInstall([attempt('npm run build', 'FAILURE')])).toEqual([])
  })

  it('ignores episodes from other tools', () => {
    expect(packagesWithFailedInstall([attempt('npm install pkg', 'FAILURE', 'write_file')])).toEqual([])
  })

  it('counts every package a failed multi-target install named', () => {
    const twice = 'npm install @tailwindcss/react @vitejs/plugin-react'
    const found = packagesWithFailedInstall([attempt(twice, 'FAILURE'), attempt(twice, 'FAILURE')])

    expect(found).toEqual(['@tailwindcss/react', '@vitejs/plugin-react'])
  })

  it('handles an empty trajectory', () => {
    expect(packagesWithFailedInstall([])).toEqual([])
  })
})
