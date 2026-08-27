import { describe, expect, it } from 'vitest'
import { probeDevTool, probeToolchain } from './devToolchainTools'

describe('development toolchain tools', () => {
  it('reports a version returned by the injected probe', () => {
    expect(probeDevTool('git', () => 'git version 2.43.0')).toMatchObject({
      id: 'git', installed: true, version: '2.43.0',
    })
  })

  it('treats an empty successful probe as unavailable', () => {
    expect(probeDevTool('python', () => '')).toMatchObject({ id: 'python', installed: false })
  })

  it('keeps the allow-list as the inventory source', () => {
    expect(probeToolchain(() => null).map((status) => status.id)).toEqual([
      'node', 'npm', 'pnpm', 'git', 'python', 'ollama',
    ])
  })
})
