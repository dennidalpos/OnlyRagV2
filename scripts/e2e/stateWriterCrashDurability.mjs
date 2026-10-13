import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(entry), '../..')
const require = createRequire(path.join(root, 'package.json'))

if (process.argv[2] === 'child') {
  const [phase, target, compiled] = process.argv.slice(3)
  if (phase === 'staged') {
    const rename = fs.promises.rename
    fs.promises.rename = async (source, destination) => {
      assert.equal(path.resolve(destination), target)
      process.send({ phase: 'staged', staging: source })
      await new Promise(() => {})
      return rename(source, destination)
    }
  }
  const { safeAtomicWrite } = require(compiled)
  assert.equal(await safeAtomicWrite(target, 'replacement'), true)
  process.send({ phase: 'acknowledged' })
  setInterval(() => {}, 1000)
} else {
  const evidence = path.join(process.env.ONLYRAG_LIVE_ROOT || path.join(os.homedir(), 'OnlyRag-Live'), `state-writer-crash-${randomUUID()}`)
  fs.mkdirSync(evidence, { recursive: true })
  const ts = require('typescript')
  const sources = ['electron/core/infrastructure/filesystem/safeAtomicFileWriter.ts', 'shared/domain/errors/errorMessage.ts']
  const hashes = {}
  for (const relative of sources) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8')
    hashes[relative] = createHash('sha256').update(source).digest('hex')
    const target = path.join(evidence, 'compiled', relative.replace(/\.ts$/, '.js'))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)
    fs.writeFileSync(path.join(evidence, path.basename(relative)), source)
  }
  const compiled = path.join(evidence, 'compiled/electron/core/infrastructure/filesystem/safeAtomicFileWriter.js')
  const report = {
    scope: 'Owned process interruption/readback; actual writer with native staging flush. No power-loss or staging-recovery qualification.',
    sources: hashes,
    cases: [],
  }
  try {
    for (const [runtime, executable] of [
      ['Node', process.execPath],
      ['Electron', require('electron')],
    ]) {
      for (const name of ['settings', 'registry', 'history', 'agent']) {
        for (const phase of ['staged', 'acknowledged']) {
          const directory = path.join(evidence, `${runtime}-${name}-${phase}`)
          fs.mkdirSync(directory)
          const target = path.join(directory, 'state.json')
          fs.writeFileSync(target, 'retained')
          const child = spawn(executable, [entry, 'child', phase, target, compiled], {
            cwd: root,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            windowsHide: true,
          })
          let output = ''
          child.stdout.on('data', (bytes) => {
            output += bytes
          })
          child.stderr.on('data', (bytes) => {
            output += bytes
          })
          const exited = new Promise((resolve, reject) => {
            child.once('error', reject)
            child.once('exit', (code, signal) => resolve({ code, signal }))
          })
          try {
            const message = await new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error(`Owned writer did not reach ${phase}: ${output}`)), 10000)
              child.once('message', (value) => {
                clearTimeout(timer)
                resolve(value)
              })
              child.once('exit', () => {
                clearTimeout(timer)
                reject(new Error(`Owned writer exited before phase: ${output}`))
              })
              child.once('error', (error) => {
                clearTimeout(timer)
                reject(error)
              })
            })
            assert.equal(message.phase, phase)
            assert(child.kill('SIGKILL'))
            await exited
            assert.equal(fs.readFileSync(target, 'utf8'), phase === 'staged' ? 'retained' : 'replacement')
            if (phase === 'staged') {
              assert.equal(path.dirname(message.staging), directory)
              assert.equal(fs.readFileSync(message.staging, 'utf8'), 'replacement')
              assert.equal(fs.readdirSync(directory).length, 2)
            } else assert.deepEqual(fs.readdirSync(directory), ['state.json'])
            report.cases.push({ runtime, name, phase, pid: child.pid, target, status: 'passed' })
          } finally {
            if (child.exitCode === null && child.signalCode === null) {
              child.kill('SIGKILL')
              await exited
            }
          }
        }
      }
    }
    report.status = 'passed'
    console.log(`PASS ${report.cases.length} native Node/Electron owned-process cuts; retained evidence ${evidence}`)
  } catch (error) {
    report.status = 'failed'
    report.error = String(error)
    throw error
  } finally {
    fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2))
  }
}
