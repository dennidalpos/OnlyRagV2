import { createRequire } from 'node:module'
import { afterAll, vi } from 'vitest'
import { createFixtureDirectory, retainFixture } from './fixtureRuntime.mjs'

// Keep fixture ownership independent of a test file's mocked fs/os/path modules.
const require = createRequire(import.meta.url)
const path = require('node:path') as typeof import('node:path')
// Every isolated Node test file gets native storage of its own, including application
// singletons imported transitively before a test can inject a repository explicitly.
const root = createFixtureDirectory('onlyrag-node-profile-')
vi.mock('../../electron/core/infrastructure/filesystem/userDataRoot', () => ({
  userDataRoot: () => root,
  userDataSessionsDir: () => path.join(root, 'sessions'),
}))

afterAll(() => retainFixture(root))
