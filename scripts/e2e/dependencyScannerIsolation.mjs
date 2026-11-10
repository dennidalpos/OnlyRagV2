import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(path.join(root, 'package.json'))
const builderRequire = createRequire(require.resolve('electron-builder/package.json'))
const builderDependency = Object.keys(builderRequire('./package.json').dependencies).find((name) => name === 'app-builder-lib')
assert(builderDependency)
const packageRequire = createRequire(builderRequire.resolve(`${builderDependency}/package.json`))
const asarDependency = Object.keys(packageRequire('./package.json').dependencies).find((name) => name === '@electron/asar')
assert(asarDependency)
const { createPackage } = packageRequire(asarDependency)
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-scanner-isolation-'))
const entry = path.join(root, 'dist-electron', 'dependencyScanWorker.js')
const resourceLimits = { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 }

async function scan(workerEntry, workspace) {
  const worker = new Worker(workerEntry, { workerData: { root: workspace }, resourceLimits })
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Native worker exceeded 60000ms')), 60_000)
      worker.once('message', (message) => {
        clearTimeout(timer)
        resolve(message)
      })
      worker.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      worker.once('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`Worker exited without evidence (${code})`))
      })
    })
  } finally {
    await worker.terminate()
    assert.equal(worker.threadId, -1)
  }
}

try {
  assert(fs.existsSync(entry), 'Run npm run build before this native guard')
  const valid = path.join(tempRoot, 'valid')
  fs.mkdirSync(path.join(valid, 'src'), { recursive: true })
  fs.writeFileSync(path.join(valid, 'package.json'), '{"name":"synthetic","dependencies":{"react":"*"}}')
  fs.writeFileSync(path.join(valid, 'src', 'app.js'), "require('react')\n")
  assert.deepEqual((await scan(entry, valid)).result.missing, {})
  fs.writeFileSync(path.join(valid, 'src', 'missing.js'), "require('undeclared-package')\n")
  assert((await scan(entry, valid)).result.missing['undeclared-package'])
  fs.writeFileSync(path.join(valid, 'src', 'broken.js'), 'const = ;')
  await assert.rejects(scan(entry, valid), /incomplete/)
  fs.unlinkSync(path.join(valid, 'src', 'broken.js'))
  fs.writeFileSync(path.join(valid, 'package.json'), '{"name":"synthetic","dependencies":{"provider":"*"}}')
  fs.mkdirSync(path.join(valid, 'node_modules', 'provider'), { recursive: true })
  fs.writeFileSync(path.join(valid, 'node_modules', 'provider', 'package.json'), '{invalid')
  await assert.rejects(scan(entry, valid), /JSON/)
  console.log('PASS native bundle: declared/missing imports, invalid source and peer-manifest refusal')

  const large = path.join(tempRoot, 'large')
  fs.mkdirSync(large)
  fs.writeFileSync(path.join(large, 'package.json'), '{"name":"synthetic","dependencies":{"react":"*"}}')
  const source = "import React from 'react'\n" + Array.from({ length: 100 }, (_, index) => `export const item${index} = React\n`).join('')
  for (let index = 0; index < 200; index++) fs.writeFileSync(path.join(large, `source-${index}.ts`), source)
  const started = performance.now()
  const measured = await scan(entry, large)
  assert.deepEqual(measured.result.missing, {})
  assert(measured.heapUsedBytes < resourceLimits.maxOldGenerationSizeMb * 1024 * 1024)
  console.log(
    `PASS bounded synthetic scan: 200 TypeScript files, ${((source.length * 200) / 1024).toFixed(0)} KiB, ${(performance.now() - started).toFixed(0)}ms, terminal heap ${(measured.heapUsedBytes / 1024 / 1024).toFixed(1)} MiB`,
  )

  // Package the installed depcheck closure, including its real dynamically resolved parsers.
  const packageRoot = path.join(tempRoot, 'package')
  fs.mkdirSync(packageRoot)
  fs.cpSync(path.join(root, 'dist-electron'), path.join(packageRoot, 'dist-electron'), { recursive: true })
  const copied = new Set()
  function copyDependency(name, importer) {
    const packageDir = importer.resolve
      .paths(name)
      .map((directory) => path.join(directory, name))
      .find((directory) => fs.existsSync(path.join(directory, 'package.json')))
    assert(packageDir, `Installed dependency unavailable: ${name}`)
    if (copied.has(packageDir)) return
    const relative = path.relative(root, packageDir)
    assert(relative.startsWith(`node_modules${path.sep}`) && !relative.split(path.sep).includes('..'))
    copied.add(packageDir)
    fs.cpSync(packageDir, path.join(packageRoot, relative), { recursive: true })
    const dependencyRequire = createRequire(path.join(packageDir, 'package.json'))
    for (const dependency of Object.keys(dependencyRequire('./package.json').dependencies || {})) copyDependency(dependency, dependencyRequire)
  }
  copyDependency('depcheck', require)
  const archive = path.join(tempRoot, 'app.asar')
  await createPackage(packageRoot, archive)
  const bootstrap = path.join(tempRoot, 'native.cjs')
  fs.writeFileSync(
    bootstrap,
    `
const assert = require('node:assert/strict')
const { app } = require('electron')
const { Worker } = require('node:worker_threads')
app.setPath('userData', ${JSON.stringify(path.join(tempRoot, 'profile'))})
app.whenReady().then(async () => {
  const worker = new Worker(${JSON.stringify(path.join(archive, 'dist-electron', 'dependencyScanWorker.js'))}, {
    workerData: { root: ${JSON.stringify(large)} }, resourceLimits: ${JSON.stringify(resourceLimits)}
  })
  try {
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ASAR scan timed out')), 30000)
      worker.once('message', value => { clearTimeout(timer); resolve(value) })
      worker.once('error', error => { clearTimeout(timer); reject(error) })
      worker.once('exit', code => { clearTimeout(timer); reject(new Error('ASAR worker exit ' + code)) })
    })
    assert.equal(result.result.scanned, true)
    assert.deepEqual(result.result.missing, {})
    assert.equal(worker.resourceLimits.maxOldGenerationSizeMb, 256)
    console.log('PASS Electron ' + process.versions.electron + ' ASAR worker + installed depcheck parsers: terminal heap ' + (result.heapUsedBytes / 1024 / 1024).toFixed(1) + ' MiB')
    await worker.terminate()
    assert.equal(worker.threadId, -1)
    app.exit(0)
  } catch (error) {
    await worker.terminate()
    throw error
  }
}).catch(error => { console.error(error); app.exit(1) })
`,
  )
  const nativeEnv = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
  delete nativeEnv.ELECTRON_RUN_AS_NODE
  const native = spawnSync(require('electron'), [bootstrap, '--disable-gpu'], {
    cwd: root,
    env: nativeEnv,
    encoding: 'utf8',
    timeout: 45_000,
    windowsHide: true,
  })
  if (native.error) throw native.error
  assert.equal(native.status, 0, native.stderr || native.stdout)
  assert(native.stdout.includes('PASS Electron'))
  console.log(native.stdout.trim())
} finally {
  assert(path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()) + path.sep))
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
