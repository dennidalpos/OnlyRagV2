import { describe, expect, it } from 'vitest'
import {
  firstDowngradingInstallTarget,
  firstInvalidRegistryInstallTarget,
  firstNonexistentInstallTarget,
} from './installCommandGuards'

describe('install command guards', () => {
  it('finds an explicitly requested package absent from the registry', async () => {
    await expect(firstNonexistentInstallTarget('npm install missing-package', async () => [
      { name: 'missing-package', exists: false },
    ])).resolves.toBe('missing-package')
  })

  it('refuses a manifest downgrade before execution', async () => {
    await expect(firstDowngradingInstallTarget(
      'npm install react@^16.8.0',
      JSON.stringify({ dependencies: { react: '^18.2.0' } }),
      async () => ({ name: 'react', exists: true, latest: '19.1.0' }),
    )).resolves.toMatchObject({ name: 'react' })
  })

  it('refuses an explicitly requested unpublished package', async () => {
    await expect(firstInvalidRegistryInstallTarget(
      'npm install missing-package@^1.0.0',
      null,
      async () => [{ name: 'missing-package', exists: true, latest: '2.0.0', versions: ['2.0.0'] }],
    )).resolves.toMatchObject({ name: 'missing-package', kind: 'unpublished' })
  })
})
