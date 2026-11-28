import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

// Keep allocation/ownership independent of Vitest's mocked modules and filesystem spies.
const require = createRequire(import.meta.url)
const fs = { ...require('node:fs') }
const os = require('node:os')
const path = require('node:path')
const realpath = fs.realpathSync.native

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const host = os.hostname().replace(/[^a-zA-Z0-9_-]/g, '_')
const run = `${process.pid}-${randomUUID().replaceAll('-', '').slice(0, 12)}`
const parent = path.join(repository, 'test-results', 'fixtures', host, run)
const registry = path.join(parent, 'manifests')
// A synthetic folder inside this checkout must never inherit the product's Git repository.
const ceiling = path.join(repository, 'test-results', 'fixtures')
process.env.GIT_CEILING_DIRECTORIES = [...new Set([...(process.env.GIT_CEILING_DIRECTORIES || '').split(path.delimiter).filter(Boolean), ceiling])].join(
  path.delimiter,
)

function plainAncestors(directory) {
  for (let current = directory; ; current = path.dirname(current)) {
    if (fs.existsSync(current) && (fs.lstatSync(current).isSymbolicLink() || realpath(current).toLowerCase() !== current.toLowerCase())) {
      throw new Error(`Fixture path must have plain ancestors: ${current}`)
    }
    if (path.dirname(current) === current) break
  }
}

/** Each allocation is empty; ownership metadata lives beside it, outside the scenario tree. */
export function createFixtureDirectory(prefix) {
  const name = path.basename(prefix)
  if (!name || name === '.' || name === '..' || /[\x00-\x1f<>:"|?*]/.test(name)) throw new Error('Invalid fixture prefix')
  plainAncestors(parent)
  fs.mkdirSync(registry, { recursive: true })
  const directory = fs.mkdtempSync(path.join(parent, name))
  const manifest = {
    schemaVersion: 1,
    repository,
    host,
    run,
    processId: process.pid,
    directory,
    createdAt: new Date().toISOString(),
    retention: 'until-explicit-cleanup',
    status: 'created',
  }
  fs.writeFileSync(path.join(registry, `${path.basename(directory)}.json`), JSON.stringify(manifest, null, 2), { flag: 'wx' })
  return directory
}

/** Validates an owned fixture without resolving links inside the scenario being tested. */
export function assertOwnedFixture(directory) {
  const absolute = path.resolve(directory)
  const root = path.join(repository, 'test-results', 'fixtures')
  const relative = path.relative(root, absolute).split(path.sep)
  if (relative.length !== 3 || relative.some((part) => !part || part === '..') || path.isAbsolute(path.relative(root, absolute))) {
    throw new Error(`Not an owned fixture: ${absolute}`)
  }
  plainAncestors(path.dirname(absolute))
  if (fs.existsSync(absolute)) plainAncestors(absolute)
  const manifestPath = path.join(path.dirname(absolute), 'manifests', `${path.basename(absolute)}.json`)
  plainAncestors(manifestPath)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (
    manifest.schemaVersion !== 1 ||
    manifest.directory !== absolute ||
    manifest.repository !== repository ||
    manifest.retention !== 'until-explicit-cleanup'
  ) {
    throw new Error(`Invalid fixture ownership: ${absolute}`)
  }
  return { directory: absolute, manifestPath, manifest }
}

/** A teardown closes resources, then records retention. It never removes or moves fixture data. */
export function retainFixture(directory) {
  const owned = assertOwnedFixture(directory)
  owned.manifest.status = fs.existsSync(owned.directory) ? 'retained' : 'removed-by-scenario'
  owned.manifest.finishedAt = new Date().toISOString()
  fs.writeFileSync(owned.manifestPath, JSON.stringify(owned.manifest, null, 2))
}
