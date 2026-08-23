import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { readWorkspaceManifest } from './workspaceManifestReader'
import { resolveVerificationCommands } from '../../domain/agent/projectVerificationResolver'

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-manifest-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('readWorkspaceManifest', () => {
  it('reports no manifest for a missing or unset workspace', () => {
    expect(readWorkspaceManifest(null).packageJson).toBeNull()
    expect(readWorkspaceManifest(path.join(tempDir, 'nope')).packageJson).toBeNull()
  })

  it('reports no manifest for an empty workspace', () => {
    const manifest = readWorkspaceManifest(tempDir)
    expect(manifest.packageJson).toBeNull()
    expect(manifest.hasFile('tsconfig.json')).toBe(false)
  })

  it('degrades to "no manifest" on a half-written package.json instead of throwing', () => {
    // The state the agent is actually in mid-scaffold.
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{ "name": "app", ')
    expect(() => readWorkspaceManifest(tempDir)).not.toThrow()
    expect(readWorkspaceManifest(tempDir).packageJson).toBeNull()
  })

  it('reads the declared scripts', () => {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'tsc && vite build', dev: 'vite' } })
    )
    expect(readWorkspaceManifest(tempDir).packageJson?.scripts?.build).toBe('tsc && vite build')
  })

  it('sees only real files, not directories', () => {
    fs.mkdirSync(path.join(tempDir, 'tsconfig.json'))
    expect(readWorkspaceManifest(tempDir).hasFile('tsconfig.json')).toBe(false)
  })

  it('refuses to probe outside the workspace', () => {
    expect(readWorkspaceManifest(tempDir).hasFile('../package.json')).toBe(false)
  })
})

describe('reader and resolver together, on the project the agent actually produced', () => {
  it('offers the build command a real generated project declares', () => {
    // package.json as written by the agent in session-1787485700613-o3tx.
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ scripts: { dev: 'vite', build: 'tsc && vite build', serve: 'vite preview' } })
    )
    fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), '{}')

    const commands = resolveVerificationCommands(readWorkspaceManifest(tempDir))

    // `dev` and `serve` are servers and must never be offered as proof the project builds.
    expect(commands.map((c) => c.command)).toEqual(['npm run build', 'npx tsc --noEmit'])
  })
})
