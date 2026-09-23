import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-cold-start-'))
const userData = path.join(tempRoot, 'user-data')
const auditPath = path.join(tempRoot, 'network-audit.jsonl')
const auditBootstrap = path.join(root, 'scripts', 'e2e', 'coldStartNetworkBootstrap.cjs')
fs.mkdirSync(userData)
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({
    version: 2,
    settings: { defaultModel: 'offline-test:latest', hasCompletedInitialSetup: true },
  }),
)

let application
try {
  application = await electron.launch({
    executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [auditBootstrap, '--disable-gpu'],
    cwd: root,
    env: {
      ...process.env,
      ONLYRAG_E2E_TEST: '1',
      ONLYRAG_E2E_USER_DATA: userData,
      ONLYRAG_E2E_NETWORK_AUDIT_PATH: auditPath,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
    timeout: 30_000,
  })

  const page = await application.firstWindow()
  const requests = []
  assert(fs.existsSync(auditPath), 'Network audit hook did not load before Electron Main')
  page.on('request', (request) => requests.push(request.url()))
  await page.reload({ waitUntil: 'load' })
  await page.waitForFunction(() => Boolean(window.electronAPI), undefined, { timeout: 20_000 })
  await page.waitForTimeout(2_000)

  const recorded = fs.readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  const external = [...recorded.map(({ address }) => address), ...requests].filter((address) => {
    const url = new URL(address)
    return ['http:', 'https:'].includes(url.protocol) && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  })
  assert.deepEqual(external, [], `Automatic external requests during process startup: ${external.join(', ')}`)
  const eagerEditorAssets = requests.filter((address) => /\/assets\/(?:editor\.api|monacoTheme|tokenizer-vendor|IngestionMarkdownEditor)/.test(address))
  assert.deepEqual(eagerEditorAssets, [], `Editor assets loaded before an editor opened: ${eagerEditorAssets.join(', ')}`)
  console.log('[PASS] Main and Renderer cold start made zero external requests across Chromium, Node HTTP/fetch, and Electron net.')
} finally {
  if (application) await application.close()
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}
