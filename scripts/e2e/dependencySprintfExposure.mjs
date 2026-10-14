import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(entry), '../..')
const require = createRequire(path.join(root, 'package.json'))
const depcheckRequire = createRequire(require.resolve('depcheck'))
const electronBuilderRequire = createRequire(require.resolve('electron-builder/package.json'))
const builderDependency = Object.keys(electronBuilderRequire('./package.json').dependencies).find((name) => name === 'app-builder-lib')
assert(builderDependency, 'electron-builder must declare app-builder-lib')
const precision = '%.101f'

if (process.argv[2] === 'scanner') {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-sprintf-'))
  try {
    fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: `echo ${precision}` } }))
    fs.writeFileSync(path.join(workspace, 'index.js'), "require('undeclared-package')\n")
    fs.writeFileSync(path.join(workspace, '.travis.yml'), `script: 'echo ${precision}'\n`)
    fs.writeFileSync(path.join(workspace, 'serverless.yml'), `service: '${precision}'\nplugins: []\n`)
    const depcheck = require('depcheck')
    const result = await depcheck(workspace, { ignorePatterns: ['node_modules'], skipMissing: false })
    assert.deepEqual(result.invalidFiles, {})
    assert.deepEqual(result.invalidDirs, {})
    assert(result.missing['undeclared-package'])
    assert(Object.keys(require.cache).some((filename) => filename.includes(`${path.sep}js-yaml${path.sep}`)))
    assert(!Object.keys(require.cache).some((filename) => /[\\/](argparse|sprintf-js)[\\/]/.test(filename)))
    console.log('PASS scanner: real YAML/script parsing does not load argparse or sprintf-js; missing imports remain visible')
  } finally {
    assert(path.dirname(workspace) === path.resolve(os.tmpdir()))
    fs.rmSync(workspace, { recursive: true })
  }
} else if (process.argv[2] === 'proxy') {
  // Only this child instruments the installed formatter; production modules remain untouched.
  const builderRequire = createRequire(electronBuilderRequire.resolve(builderDependency))
  const getRequire = createRequire(builderRequire.resolve('@electron/get'))
  const agentRequire = createRequire(getRequire.resolve('global-agent'))
  const formatter = agentRequire('sprintf-js')
  const original = formatter.sprintf
  const formats = []
  formatter.sprintf = (format, ...values) => {
    formats.push(format)
    return original(format, ...values)
  }
  try {
    process.env.ROARR_LOG = 'true'
    agentRequire('roarr')
    globalThis.ROARR.write = () => {}
    const createProxyController = agentRequire('./factories/createProxyController.js').default
    const controller = createProxyController()
    controller.HTTP_PROXY = `http://${precision}:1`
    controller.HTTPS_PROXY = `http://${precision}:2`
    controller.NO_PROXY = precision
    assert.equal(formats.length, 3)
    assert.deepEqual(formats, ['configuration changed', 'configuration changed', 'configuration changed'])
    const logger = agentRequire('./Logger.js').default
    logger.error({ error: { message: precision } }, 'request error')
    logger.trace({ destination: precision, headers: { 'x-fixture': precision } }, 'proxying response')
    assert.deepEqual(formats.slice(3), ['request error', 'proxying response'])
    console.log('PASS builder proxy: controlled configuration/error/response values stay outside fixed format strings')
  } finally {
    formatter.sprintf = original
  }
} else {
  for (const importer of [depcheckRequire, require]) {
    assert.throws(() => importer('sprintf-js').sprintf(precision, 1), RangeError)
  }
  console.log('PASS baseline: both installed sprintf-js copies reproduce the advisory RangeError')
  for (const mode of ['scanner', 'proxy']) {
    const result = spawnSync(process.execPath, [entry, mode], { cwd: root, encoding: 'utf8', timeout: 30_000, windowsHide: true })
    if (result.error) throw result.error
    assert.equal(result.status, 0, result.stderr || result.stdout)
    console.log(result.stdout.trim())
  }
}
