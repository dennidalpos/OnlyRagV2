import { describe, it, expect } from 'vitest'
import { __testing } from './agentToolExecutorService'

const {
  resolveCommandTimeoutMs,
  isLongRunningCommand,
  isBlockingDevServerCommand,
  extractRequestedPackageNames,
  findAlreadyInstalledPackages,
} = __testing

describe('run_command timeout policy', () => {
  it('should give installs and scaffolding a long ceiling instead of the old fixed 60s', () => {
    expect(isLongRunningCommand('npm install')).toBe(true)
    expect(isLongRunningCommand('pnpm add react')).toBe(true)
    expect(isLongRunningCommand('pip install fastapi')).toBe(true)
    expect(isLongRunningCommand('npx create-vite@latest .')).toBe(true)
    expect(isLongRunningCommand('git clone https://example.com/repo.git')).toBe(true)

    expect(resolveCommandTimeoutMs('npm install')).toBe(600000)
    expect(resolveCommandTimeoutMs('npm install')).toBeGreaterThan(resolveCommandTimeoutMs('npm run lint'))
  })

  it('should keep ordinary commands on the default ceiling', () => {
    expect(isLongRunningCommand('git status')).toBe(false)
    expect(isLongRunningCommand('npm run build')).toBe(false)
    expect(resolveCommandTimeoutMs('git status')).toBe(120000)
  })

  it('should honour an explicit override, clamped to sane bounds', () => {
    expect(resolveCommandTimeoutMs('npm run build', 30)).toBe(30000)
    expect(resolveCommandTimeoutMs('npm run build', 99999)).toBe(900000)
    expect(resolveCommandTimeoutMs('npm run build', 1)).toBe(5000)
    expect(resolveCommandTimeoutMs('npm run build', 'not-a-number')).toBe(120000)
    expect(resolveCommandTimeoutMs('npm run build', -5)).toBe(120000)
  })
})

describe('blocking dev-server command detection', () => {
  it('must flag commands that start a dev/watch server and never exit on their own (regression: "npm install; npm run dev" hung for the full 600s install ceiling twice in the same production session, with no error the model could learn from)', () => {
    expect(isBlockingDevServerCommand('npm run dev')).toBe(true)
    expect(isBlockingDevServerCommand('npm install; npm run dev')).toBe(true)
    expect(isBlockingDevServerCommand('npm start')).toBe(true)
    expect(isBlockingDevServerCommand('yarn dev')).toBe(true)
    expect(isBlockingDevServerCommand('pnpm run serve')).toBe(true)
    expect(isBlockingDevServerCommand('vite')).toBe(true)
    expect(isBlockingDevServerCommand('vite preview')).toBe(true)
    expect(isBlockingDevServerCommand('next dev')).toBe(true)
    expect(isBlockingDevServerCommand('next start')).toBe(true)
    expect(isBlockingDevServerCommand('ng serve')).toBe(true)
    expect(isBlockingDevServerCommand('webpack serve')).toBe(true)
    expect(isBlockingDevServerCommand('nodemon src/index.js')).toBe(true)
    expect(isBlockingDevServerCommand('flask run')).toBe(true)
    expect(isBlockingDevServerCommand('python -m http.server 8080')).toBe(true)
    expect(isBlockingDevServerCommand('npx vitest --watch')).toBe(true)
    expect(isBlockingDevServerCommand('jest --watchAll')).toBe(true)
  })

  it('must not flag one-shot build/verification commands', () => {
    expect(isBlockingDevServerCommand('npm run build')).toBe(false)
    expect(isBlockingDevServerCommand('vite build')).toBe(false)
    expect(isBlockingDevServerCommand('next build')).toBe(false)
    expect(isBlockingDevServerCommand('npm test')).toBe(false)
    expect(isBlockingDevServerCommand('npx vitest run')).toBe(false)
    expect(isBlockingDevServerCommand('tsc --noEmit')).toBe(false)
    expect(isBlockingDevServerCommand('git status')).toBe(false)
    expect(isBlockingDevServerCommand('npm install')).toBe(false)
    expect(isBlockingDevServerCommand('npm install react react-dom tailwindcss postcss autoprefixer vite')).toBe(false)
    expect(isBlockingDevServerCommand('npm i -D vite @vitejs/plugin-react')).toBe(false)
    expect(isBlockingDevServerCommand('pnpm add -D vite')).toBe(false)
    expect(isBlockingDevServerCommand('yarn add vite')).toBe(false)
  })
})

describe('redundant install detection', () => {
  const packageJson = JSON.stringify({
    dependencies: { react: '^19.0.0' },
    devDependencies: { tailwindcss: '^4.0.0', postcss: '^8.0.0', autoprefixer: '^10.0.0' },
  })

  it('extracts package names, stripping flags and version specifiers', () => {
    expect(extractRequestedPackageNames('npm install -D tailwindcss postcss autoprefixer')).toEqual([
      'tailwindcss', 'postcss', 'autoprefixer',
    ])
    expect(extractRequestedPackageNames('npm install tailwindcss postcss autoprefixer --save-dev')).toEqual([
      'tailwindcss', 'postcss', 'autoprefixer',
    ])
    expect(extractRequestedPackageNames('npm i react@18.2.0')).toEqual(['react'])
    expect(extractRequestedPackageNames('yarn add @tanstack/react-virtual@3.14.10')).toEqual(['@tanstack/react-virtual'])
    expect(extractRequestedPackageNames('npm install')).toEqual([])
    expect(extractRequestedPackageNames('npm ci')).toEqual([])
    expect(extractRequestedPackageNames('npm run build')).toEqual([])
  })

  it('must flag every-package-already-present installs as redundant (regression: the same tailwind install was re-run 19 times in one production session because nothing checked package.json first)', () => {
    expect(findAlreadyInstalledPackages(['tailwindcss', 'postcss', 'autoprefixer'], packageJson)).toEqual([
      'tailwindcss', 'postcss', 'autoprefixer',
    ])
    // Different flag order/position than what's in package.json.dependencies -- the check is
    // purely name-based, so this near-variant phrasing is caught too.
    expect(findAlreadyInstalledPackages(['tailwindcss', 'postcss', 'autoprefixer'], packageJson)).not.toBeNull()
  })

  it('must not flag installs where at least one package is genuinely new, or when package.json is missing/unparsable', () => {
    expect(findAlreadyInstalledPackages(['tailwindcss', 'new-package'], packageJson)).toBeNull()
    expect(findAlreadyInstalledPackages(['react'], 'not valid json')).toBeNull()
    expect(findAlreadyInstalledPackages([], packageJson)).toBeNull()
  })
})
