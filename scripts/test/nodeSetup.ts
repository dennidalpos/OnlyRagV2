import { createRequire } from 'node:module'
import { afterAll, vi } from 'vitest'

// Keep fixture ownership independent of a test file's mocked fs/os/path modules.
const require = createRequire(import.meta.url)
const fs = require('node:fs') as typeof import('node:fs')
const os = require('node:os') as typeof import('node:os')
const path = require('node:path') as typeof import('node:path')
const remove = fs.rmSync
const realpath = fs.realpathSync.native
// Every isolated Node test file gets native storage of its own, including application
// singletons imported transitively before a test can inject a repository explicitly.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-node-profile-'))
vi.mock('../../electron/core/infrastructure/filesystem/userDataRoot', () => ({
  userDataRoot: () => root,
  userDataSessionsDir: () => path.join(root, 'sessions'),
}))

afterAll(() => {
  const directory = realpath(root)
  if (path.dirname(directory).toLowerCase() !== realpath(os.tmpdir()).toLowerCase() || !path.basename(directory).startsWith('onlyrag-node-profile-')) {
    throw new Error('Refusing cleanup outside the owned Node test profile')
  }
  remove(directory, { recursive: true, force: true })
})
