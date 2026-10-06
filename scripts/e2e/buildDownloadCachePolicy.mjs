import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(path.join(root, 'package.json'))
const electronBuilderRequire = createRequire(require.resolve('electron-builder/package.json'))
const builderPackage = Object.keys(electronBuilderRequire('./package.json').dependencies).find((name) => name === 'app-builder-lib')
assert(builderPackage, 'electron-builder must declare the artifact downloader dependency')
const builderRequire = createRequire(electronBuilderRequire.resolve(builderPackage))
const getRequire = createRequire(builderRequire.resolve('@electron/get'))
const { downloadArtifact, GotDownloader } = builderRequire('@electron/get')
const got = getRequire('got').default
const config = require('./package.json').build
assert.equal(got.defaults.options.cache, undefined, 'Got HTTP caching must remain disabled')
assert.equal(config.electronDownload?.downloadOptions?.cache, undefined, 'Review any new HTTP cache configuration')
assert.equal(config.electronDownload?.isVerifyChecksum, undefined, 'Default checksum validation must remain enabled')

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-download-policy-'))
const bytes = Buffer.from('Isolated download integrity fixture\n')
const checksum = createHash('sha256').update(bytes).digest('hex')
const requests = []
const server = http.createServer((request, response) => {
  requests.push({ url: request.url, cookie: request.headers.cookie })
  response.writeHead(200, {
    'Cache-Control': 'public, max-age=3600',
    'Set-Cookie': 'fixture=synthetic; HttpOnly',
    'Content-Length': bytes.length,
  })
  response.end(bytes)
})
const previousProgress = process.env.ELECTRON_GET_NO_PROGRESS
process.env.ELECTRON_GET_NO_PROGRESS = '1'

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const downloader = new GotDownloader()
  const downloadOptions = { quiet: true, timeout: { request: 5000 }, retry: { limit: 0 } }
  await downloader.download(`${baseUrl}/response.bin`, path.join(tempRoot, 'first.bin'), downloadOptions)
  await downloader.download(`${baseUrl}/response.bin`, path.join(tempRoot, 'second.bin'), {
    ...downloadOptions,
    headers: { 'cache-control': 'max-stale=999999' },
  })
  assert.equal(requests.length, 2, 'Same-URL downloads must both reach the server without an HTTP cache')
  assert.equal(requests[1].cookie, undefined, 'A response cookie must not become a later request credential')
  assert.deepEqual(fs.readFileSync(path.join(tempRoot, 'second.bin')), bytes)
  console.log('PASS: default downloader bypasses HTTP cache and does not replay response cookies')

  // Exercise the installed artifact cache independently of Got's HTTP cache.
  const options = {
    version: '9.9.9',
    artifactName: 'fixture.bin',
    isGeneric: true,
    cacheRoot: path.join(tempRoot, 'cache'),
    tempDirectory: tempRoot,
    mirrorOptions: { resolveAssetURL: async () => `${baseUrl}/artifact.bin` },
    checksums: { 'fixture.bin': checksum },
    downloadOptions,
  }
  const artifact = await downloadArtifact(options)
  assert.deepEqual(fs.readFileSync(artifact), bytes)
  assert.equal(await downloadArtifact(options), artifact)
  assert.equal(requests.length, 3, 'Validated artifact cache readback must avoid a second download')
  console.log('PASS: artifact download validates checksum and reuses the verified disk cache')

  fs.writeFileSync(artifact, 'Corrupt synthetic artifact')
  const recovered = await downloadArtifact(options)
  assert.deepEqual(fs.readFileSync(recovered), bytes)
  assert.equal(requests.length, 4, 'A corrupt cached artifact must be rejected and downloaded again')
  await assert.rejects(downloadArtifact({ ...options, force: true, checksums: { 'fixture.bin': '0'.repeat(64) } }), /checksum|sum|digest/i)
  assert.deepEqual(fs.readFileSync(recovered), bytes, 'Refused download must preserve the acknowledged cache entry')
  console.log('PASS: corrupt cache and incorrect download checksum are refused without losing the valid artifact')
} finally {
  if (previousProgress === undefined) delete process.env.ELECTRON_GET_NO_PROGRESS
  else process.env.ELECTRON_GET_NO_PROGRESS = previousProgress
  server.closeAllConnections()
  await new Promise((resolve, reject) => server.close((error) => (error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve())))
  const ownedPath = path.resolve(tempRoot)
  assert.equal(path.dirname(ownedPath), path.resolve(os.tmpdir()))
  fs.rmSync(ownedPath, { recursive: true, force: true })
}
