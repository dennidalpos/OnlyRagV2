import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
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
  // Bootstrap changes global agents only inside this isolated child.
  const builderRequire = createRequire(electronBuilderRequire.resolve(builderDependency))
  const getRequire = createRequire(builderRequire.resolve('@electron/get'))
  const seen = []
  const server = http.createServer((request, response) => {
    seen.push(request.url)
    response.end('synthetic proxy response')
  })
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    process.env.GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE = 'ONLYRAG_FIXTURE_'
    process.env.ONLYRAG_FIXTURE_HTTP_PROXY = `http://127.0.0.1:${server.address().port}`
    process.env.ONLYRAG_FIXTURE_HTTPS_PROXY = process.env.ONLYRAG_FIXTURE_HTTP_PROXY
    process.env.ONLYRAG_FIXTURE_NO_PROXY = ''
    getRequire('./proxy.js').initializeProxy()
    const target = `http://onlyrag-fixture.invalid/${encodeURIComponent(precision)}`
    const body = await new Promise((resolve, reject) => {
      const request = http.get(target, (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          body += chunk
        })
        response.on('end', () => resolve(body))
        response.on('error', reject)
      })
      request.setTimeout(5000, () => request.destroy(new Error('Fixture proxy timed out')))
      request.on('error', reject)
    })
    assert.equal(body, 'synthetic proxy response')
    assert.deepEqual(seen, [target])
    assert(!Object.keys(require.cache).some((filename) => /[\\/]sprintf-js[\\/]/.test(filename)))
    console.log('PASS builder: installed @electron/get bootstraps global-agent 4 and uses the loopback proxy')
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
} else {
  for (const importer of [depcheckRequire, require]) {
    assert.throws(() => importer.resolve('sprintf-js'), { code: 'MODULE_NOT_FOUND' })
  }
  const lock = require('./package-lock.json')
  assert(!Object.keys(lock.packages).some((name) => /(?:^|\/)node_modules\/sprintf-js$/.test(name)))
  console.log('PASS dependency closure: no sprintf-js copy remains in the installed tree or lock')
  const yamlCli = path.join(path.dirname(depcheckRequire.resolve('js-yaml/package.json')), 'bin/js-yaml.js')
  const runYaml = (args, input) => {
    const result = spawnSync(process.execPath, [yamlCli, ...args], { input, encoding: 'utf8', timeout: 5000, windowsHide: true })
    if (result.error) throw result.error
    return result
  }
  assert.equal(runYaml(['--help']).status, 0)
  // The application uses the v3 library, not its deprecated version option.
  // The exposed root CLI is js-yaml v4 and keeps its supported version API.
  const rootYamlCli = path.join(path.dirname(require.resolve('js-yaml/package.json')), 'bin/js-yaml.js')
  const version = spawnSync(process.execPath, [rootYamlCli, '--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true })
  assert.equal(version.status, 0, version.stderr)
  assert.match(version.stdout, /4\.3\.2/)
  const yaml = runYaml(['--compact', '--trace'], `message: '${precision}'\n`)
  assert.equal(yaml.status, 0, yaml.stderr)
  assert.deepEqual(JSON.parse(yaml.stdout), { message: precision })
  const json = runYaml([], JSON.stringify({ message: precision }))
  assert.equal(json.status, 0, json.stderr)
  assert.match(json.stdout, /%\.101f/)
  assert.equal(runYaml(['--compact'], 'invalid: [').status, 1)
  console.log('PASS YAML: root CLI version, legacy help/conversions and invalid-input handling')
  for (const mode of ['scanner', 'proxy']) {
    const result = spawnSync(process.execPath, [entry, mode], { cwd: root, encoding: 'utf8', timeout: 30_000, windowsHide: true })
    if (result.error) throw result.error
    assert.equal(result.status, 0, result.stderr || result.stdout)
    console.log(result.stdout.trim())
  }
}
