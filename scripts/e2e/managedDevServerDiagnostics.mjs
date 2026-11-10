import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Bounded native investigation, not a claim that an intermittent failure is fixed.
// Usage: node scripts/e2e/managedDevServerDiagnostics.mjs [rounds: 1..20]
assert.equal(process.platform, 'win32', 'These listener/process receipts require Windows.')
const rounds = Number(process.argv[2] ?? 5)
assert(Number.isInteger(rounds) && rounds >= 1 && rounds <= 20, 'Expected 1..20 rounds.')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const evidence = path.join(process.env.ONLYRAG_LIVE_ROOT || path.join(os.homedir(), 'OnlyRag-Live'), `managed-dev-diagnostics-${randomUUID()}`)
fs.mkdirSync(evidence, { recursive: true })
const relative = 'electron/core/infrastructure/process/managedDevServerRepository.ts'
const source = fs.readFileSync(path.join(root, relative))
fs.writeFileSync(path.join(evidence, 'managedDevServerRepository.ts'), source)
fs.copyFileSync(fileURLToPath(import.meta.url), path.join(evidence, 'runner.mjs'))
const ts = require('typescript')
const compiled = path.join(evidence, 'repository.cjs')
fs.writeFileSync(
  compiled,
  ts.transpileModule(source.toString('utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText,
)
const { ManagedDevServerRepository } = require(compiled)
const report = {
  scope: 'Native source Vite startup, loopback admission and owned stop; no installed app or historical root-cause qualification.',
  node: process.version,
  platform: process.platform,
  release: os.release(),
  pid: process.pid,
  source: { path: relative, sha256: createHash('sha256').update(source).digest('hex') },
  rounds,
  cases: [],
}
const originalConnect = net.connect
const snapshot = (port) => {
  try {
    return execFileSync(path.join(process.env.SystemRoot, 'System32/netstat.exe'), ['-ano', '-p', 'tcp'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    })
      .split(/\r?\n/)
      .filter((row) => row.trim().split(/\s+/)[1]?.endsWith(`:${port}`))
  } catch (error) {
    return [`Snapshot unavailable: ${String(error)}`]
  }
}
const save = () => fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
console.log(`Evidence: ${evidence}`)
try {
  for (let round = 0; round < rounds; round++) {
    for (const mode of ['vite', 'forced-self-connect', 'single-readiness', 'wildcard-ipv4', 'wildcard-ipv6']) {
      const workspace = fs.mkdtempSync(path.join(root, 'node_modules/onlyrag-managed-diagnostic-'))
      const repository = new ManagedDevServerRepository()
      const startedAt = performance.now()
      const receipt = { round, mode, workspace, sockets: [], passed: false }
      report.cases.push(receipt)
      let ready = false
      let redundantProbes = 0
      net.connect = (options) => {
        const forced = mode === 'forced-self-connect' && options.host === '127.0.0.2'
        const redundant = mode === 'single-readiness' && ready && options.host === '127.0.0.1'
        if (redundant) redundantProbes++
        const actual = redundant ? { ...options, port: 0 } : forced ? { ...options, localAddress: options.host, localPort: options.port } : options
        const item = { target: options, actual, events: [] }
        receipt.sockets.push(item)
        const socket = originalConnect(actual)
        const record = (event, error) =>
          item.events.push({
            event,
            elapsedMs: performance.now() - startedAt,
            error: error?.code,
            localAddress: socket.localAddress,
            localPort: socket.localPort,
            remoteAddress: socket.remoteAddress,
            remotePort: socket.remotePort,
          })
        socket.once('connect', () => {
          if (options.host === '127.0.0.1') ready = true
          record('connect') // Capture endpoints before production destroys the socket.
          if (options.host === '127.0.0.2') item.listeners = snapshot(options.port)
        })
        socket.once('error', (error) => record('error', error))
        socket.once('timeout', () => record('timeout'))
        socket.once('close', () => record('close'))
        return socket
      }
      try {
        const wildcard = mode.startsWith('wildcard-')
        const host = mode === 'wildcard-ipv6' ? '::' : '0.0.0.0'
        fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { dev: wildcard ? 'node server.cjs' : 'vite' } }))
        fs.writeFileSync(path.join(workspace, 'index.html'), '<!doctype html><title>Owned diagnostic preview</title>')
        fs.writeFileSync(
          path.join(workspace, 'vite.config.mjs'),
          "import fs from 'node:fs'; export default { plugins: [{ name: 'receipt', configureServer(server) { server.httpServer.once('listening', () => fs.writeFileSync('listener.json', JSON.stringify({ address: server.httpServer.address(), pid: process.pid }))) } }] }",
        )
        fs.writeFileSync(
          path.join(workspace, 'server.cjs'),
          `const fs = require('node:fs'); const server = require('node:http').createServer((req, res) => res.end('exposed')); server.listen(Number(process.env.PORT), '${host}', () => fs.writeFileSync('listener.json', JSON.stringify({ address: server.address(), pid: process.pid })));`,
        )
        let started
        try {
          started = await repository.start(workspace)
        } catch (error) {
          receipt.admissionError = String(error)
          if (!wildcard) throw error
          assert.match(String(error), /must bind only/)
        }
        if (wildcard) {
          assert.equal(started, undefined, 'An externally reachable listener must be refused.')
          assert.equal(repository.runningPort(workspace), null)
        } else {
          assert(started)
          receipt.started = started
          receipt.listeners = snapshot(started.port)
          const response = await repository.probe(workspace, `http://127.0.0.1:${started.port}/`)
          assert.equal(response.status, 200)
          assert.match(response.body, /Owned diagnostic preview/)
          assert.equal(redundantProbes, 0)
          if (mode === 'forced-self-connect')
            assert(
              receipt.sockets.some((item) =>
                item.events.some(
                  (event) =>
                    event.event === 'connect' &&
                    event.localAddress === '127.0.0.2' &&
                    event.localAddress === event.remoteAddress &&
                    event.localPort === event.remotePort,
                ),
              ),
            )
          receipt.stopped = repository.stop(workspace)
          assert.equal(receipt.stopped.pid, started.pid)
          assert.equal(repository.runningPort(workspace), null)
        }
        receipt.listener = JSON.parse(fs.readFileSync(path.join(workspace, 'listener.json'), 'utf8'))
        assert.equal(receipt.listener.address.address, wildcard ? host : '127.0.0.1')
        receipt.passed = true
      } catch (error) {
        receipt.error = String(error.stack || error)
        throw error
      } finally {
        net.connect = originalConnect
        try {
          repository.stopAll()
          // Keep diagnostic data even for successful cases; remove only this owned fixture.
          const destination = path.join(evidence, `workspace-${round}-${mode}`)
          fs.cpSync(workspace, destination, { recursive: true })
          receipt.files = fs
            .readdirSync(workspace, { recursive: true, withFileTypes: true })
            .filter((entry) => {
              assert(!entry.isSymbolicLink(), 'Unexpected link in owned diagnostic fixture.')
              return entry.isFile()
            })
            .map((entry) => {
              const name = path.relative(workspace, path.join(entry.parentPath, entry.name))
              const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
              const sha256 = hash(path.join(workspace, name))
              assert.equal(hash(path.join(destination, name)), sha256, 'Diagnostic copy readback mismatch.')
              return { path: name, sha256 }
            })
          const resolved = fs.realpathSync.native(workspace)
          assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync.native(path.join(root, 'node_modules')).toLowerCase())
          assert(path.basename(resolved).startsWith('onlyrag-managed-diagnostic-'))
          if (receipt.passed) fs.rmSync(resolved, { recursive: true })
          receipt.retainedWorkspace = destination
        } catch (error) {
          receipt.cleanupError = String(error)
          receipt.passed = false
        } finally {
          await new Promise((resolve) => setImmediate(resolve))
          receipt.elapsedMs = performance.now() - startedAt
          save()
        }
      }
      assert(receipt.passed, receipt.cleanupError || receipt.error)
      console.log(`Round ${round + 1}/${rounds}: ${mode} passed`)
    }
  }
} finally {
  net.connect = originalConnect
  save()
}
assert.equal(report.cases.length, rounds * 5)
assert(report.cases.every((item) => item.passed))
console.log(`${report.cases.length} native cases passed. Historical intermittency remains unestablished.`)
