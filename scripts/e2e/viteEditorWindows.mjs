import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer, version } from 'vite'

assert.equal(process.platform, 'win32')
const evidence = path.join(process.env.ONLYRAG_LIVE_ROOT || path.join(os.homedir(), 'OnlyRag-Live'), `vite-editor-${randomUUID()}`)
fs.mkdirSync(evidence, { recursive: true })
const receipt = path.join(evidence, 'editor.jsonl')
const helper = path.join(evidence, 'editor.cjs')
fs.writeFileSync(helper, String.raw`require('node:fs').appendFileSync(process.env.ONLYRAG_EDITOR_RECEIPT, JSON.stringify(process.argv.slice(2)) + '\n')`)
const editor = path.join(evidence, 'editor.cmd')
fs.writeFileSync(editor, `@"${process.execPath}" "${helper}" %*\r\n`)
const previous = Object.fromEntries(['LAUNCH_EDITOR', 'ONLYRAG_EDITOR_RECEIPT', 'ONLYRAG_EDITOR_PROBE'].map((name) => [name, process.env[name]]))
const report = { vite: version, checks: [], complete: false, messages: [] }
const originalLog = console.log
let server
try {
  process.env.LAUNCH_EDITOR = editor
  process.env.ONLYRAG_EDITOR_RECEIPT = receipt
  process.env.ONLYRAG_EDITOR_PROBE = 'owned-value'
  server = await createServer({ configFile: false, root: evidence, server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'silent' })
  await server.listen()
  const address = server.httpServer.address()
  assert(address && typeof address !== 'string')
  const open = async (file) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/__open-in-editor?file=${encodeURIComponent(file)}`)
    assert.equal(response.status, 200)
  }
  const ordinary = path.join(evidence, 'ordinary file.txt')
  fs.writeFileSync(ordinary, 'owned editor fixture')
  await open(ordinary)
  const deadline = Date.now() + 10000
  while (!fs.existsSync(receipt) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
  assert(fs.existsSync(receipt), 'The real Windows editor subprocess must acknowledge the ordinary filename')
  const accepted = fs.readFileSync(receipt, 'utf8')
  assert.deepEqual(JSON.parse(accepted.trim()), [ordinary])
  report.checks.push('Real Windows editor subprocess receives the exact ordinary path with spaces')
  console.log = (...args) => report.messages.push(args.map(String).join(' '))
  const hostile = path.join(evidence, 'hostile%ONLYRAG_EDITOR_PROBE%&.txt')
  fs.writeFileSync(hostile, 'must remain unchanged')
  await open(hostile)
  assert(
    report.messages.some((message) => message.includes('argument containing "%"')),
    'The installed patch must refuse percent expansion before spawning',
  )
  assert.equal(fs.readFileSync(receipt, 'utf8'), accepted)
  assert.equal(fs.readFileSync(hostile, 'utf8'), 'must remain unchanged')
  report.checks.push('Actual Vite editor middleware refuses a percent/ampersand filename without another launch')
  report.complete = true
} catch (error) {
  report.error = String(error)
  throw error
} finally {
  console.log = originalLog
  await server?.close()
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
}
console.log(`PASS Vite ${version} native Windows editor checks; ${evidence}`)
