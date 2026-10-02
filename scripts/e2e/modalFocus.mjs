import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const evidence = path.join(
  process.env.ONLYRAG_LIVE_ROOT || path.join(os.homedir(), 'OnlyRag-Live'),
  `modal-focus-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
)
fs.mkdirSync(evidence, { recursive: true })
const result = await build({
  configFile: false,
  root,
  plugins: [react(), tailwindcss()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: { write: false, minify: false, lib: { entry: path.join(root, 'scripts/e2e/modalFocusFixture.tsx'), name: 'ModalFixture', formats: ['iife'] } },
})
const output = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output)
const javascript = output
  .filter((item) => item.type === 'chunk')
  .map((item) => item.code)
  .join('\n')
const css = output
  .filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
  .map((item) => String(item.source))
  .join('\n')
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const report = { browser: browser.version(), checks: [], status: 'running' }
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Accessibility.enable')
  const accessibleTree = async (name) => {
    const tree = await cdp.send('Accessibility.getFullAXTree')
    fs.writeFileSync(path.join(evidence, `${name}-accessibility.json`), JSON.stringify(tree, null, 2) + '\n', 'utf8')
    return tree.nodes.filter((node) => !node.ignored)
  }
  await page.route('**/*', (route) => route.abort())
  await page.setContent(
    '<!doctype html><html><head><title>OnlyRag modal keyboard fixture</title></head><body><div id="root"></div><aside inert="inert" id="preserved">Already inert</aside></body></html>',
  )
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: javascript })
  const active = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent)
  await page.getByRole('button', { name: 'Open base', exact: true }).click()
  assert(await page.locator('#root').evaluate((element) => element.inert))
  await page.keyboard.press('Shift+Tab')
  assert.equal(await active(), 'Close base')
  await page.keyboard.press('Tab')
  assert.equal(await active(), 'Base input')
  await page.evaluate(() => document.getElementById('trigger').focus())
  assert.equal(await active(), 'Base input')
  await page.evaluate(() => {
    const button = document.createElement('button')
    button.id = 'late-background'
    button.textContent = 'Late background'
    document.body.append(button)
  })
  assert(await page.locator('#late-background').evaluate((element) => element.inert))
  report.checks.push('Initial focus, Tab/Shift+Tab wrap, disabled/hidden exclusion, inert focus blocking and dynamic background.')

  await page.getByRole('button', { name: 'Open nested', exact: true }).click()
  const nestedTree = await accessibleTree('nested')
  assert(nestedTree.some((node) => node.name?.value === 'Nested dialog'))
  assert(!nestedTree.some((node) => ['Base dialog', 'Background information', 'Already inert'].includes(node.name?.value)))
  assert.equal(nestedTree.filter((node) => node.role?.value === 'dialog').length, 1)
  await page.keyboard.press('Shift+Tab')
  assert.equal(await active(), 'Close nested')
  await page.keyboard.press('Tab')
  assert.equal(await active(), 'Nested input')
  await page.keyboard.press('Tab')
  assert.equal(await active(), 'First choice')
  await page.keyboard.press('Tab')
  assert.equal(await active(), 'Close nested')
  await page.keyboard.press('Escape')
  assert.equal(await active(), 'Open nested')
  assert.equal((await accessibleTree('base')).filter((node) => node.role?.value === 'dialog').length, 1)
  report.checks.push('Nested focus cycle, native accessible-tree isolation, topmost-only Escape and trigger restoration.')

  await page.getByRole('button', { name: 'Open approval', exact: true }).click()
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('#rejections').textContent(), '0')
  const approvalTree = await accessibleTree('approval')
  assert.equal(approvalTree.filter((node) => node.role?.value === 'dialog').length, 1)
  assert(!approvalTree.some((node) => node.name?.value === 'Base dialog'))
  await page.screenshot({ path: path.join(evidence, 'approval.png') })
  await page.getByRole('button', { name: /Reject/ }).click()
  assert.equal(await page.locator('#rejections').textContent(), '1')
  assert.equal(await active(), 'Open approval')
  await page.keyboard.press('Escape')
  assert.equal(await active(), 'Open base')
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(await page.locator('#root').evaluate((element) => element.inert), false)
  assert.equal(await page.locator('#preserved').getAttribute('inert'), 'inert')
  assert.equal(await page.locator('#late-background').evaluate((element) => element.inert), false)
  report.checks.push('Actual pending-approval component requires explicit rejection; parent and original inert state restored.')
  report.status = 'passed'
  console.log(`Modal keyboard/accessibility checks passed: ${evidence}`)
} catch (error) {
  report.status = 'failed'
  report.error = String(error)
  console.error(`Modal evidence: ${evidence}`)
  throw error
} finally {
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
  await browser.close()
}
