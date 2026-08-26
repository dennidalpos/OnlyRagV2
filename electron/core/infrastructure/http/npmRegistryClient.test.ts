import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NpmRegistryClient } from './npmRegistryClient'

describe('NpmRegistryClient', () => {
  const client = new NpmRegistryClient()

  beforeEach(() => client.clearCache())
  afterEach(() => vi.restoreAllMocks())

  it('reads latest and every published version from the abbreviated packument', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          'dist-tags': { latest: '8.0.0' },
          versions: { '4.5.14': {}, '8.0.0': {} },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    await expect(client.lookup('@vitejs/plugin-react')).resolves.toEqual({
      name: '@vitejs/plugin-react',
      exists: true,
      latest: '8.0.0',
      versions: ['4.5.14', '8.0.0'],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.npmjs.org/%40vitejs%2Fplugin-react',
      expect.objectContaining({ headers: { Accept: 'application/vnd.npm.install-v1+json' } })
    )
  })

  it('keeps a network failure inconclusive instead of inventing a refusal', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))

    await expect(client.lookup('vite')).resolves.toEqual({ name: 'vite', exists: true })
  })
})
