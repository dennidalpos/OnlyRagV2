import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { _electron as electron } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const evidence = process.env.ONLYRAG_TOOLTIP_EVIDENCE || fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-tooltip-'))
fs.mkdirSync(evidence, { recursive: true })
const modulePath = (relative) => JSON.stringify(path.join(root, relative).replaceAll('\\', '/'))
const entry = `
import React, {useState} from ${modulePath('node_modules/react/index.js')};
import {createRoot} from ${modulePath('node_modules/react-dom/client.js')};
import {Tooltip} from ${modulePath('src/components/common/Tooltip.tsx')};
import {Modal} from ${modulePath('src/components/common/Modal.tsx')};
import {I18nProvider,useTranslation} from ${modulePath('src/i18n/index.ts')};
import {CodingAgentDebugToggle} from ${modulePath('src/components/settings/CodingAgentDebugToggle.tsx')};
import {ModelBadgeStrip} from ${modulePath('src/components/settings/ModelBadgeStrip.tsx')};
import ${modulePath('src/index.css')};
function Harness(){
 const [base,setBase]=useState(false),[nested,setNested]=useState(false);
 const [debug,setDebug]=useState(false);const {setLanguage}=useTranslation();
 return <div className="p-4">
  <button id="english" onClick={()=>setLanguage('en')}>English</button>
  <button id="italian" onClick={()=>setLanguage('it')}>Italiano</button>
  <button id="open" onClick={()=>setBase(true)}>Open</button>
  <p role="alert">Controlled storage error: Retry</p>
  <div id="debug"><CodingAgentDebugToggle settings={{defaultModel:'',ollamaHost:'http://127.0.0.1:1',ocrEngine:'native_cuda',enableCodingAgentDebugLog:debug}} onUpdateSettings={s=>setDebug(s.enableCodingAgentDebugLog)}/></div>
  <div id="badges"><ModelBadgeStrip status="compatible" metrics={{capabilities:['tools'],contextLength:32768}}/></div>
  <div style={{position:'fixed',right:0,bottom:0,width:24,height:24,overflow:'hidden'}}><Tooltip helpKey="settings_fullExcelFormatDesc"><button id="edge">?</button></Tooltip></div>
  <Modal isOpen={base} onClose={()=>setBase(false)}>
   <h2>Base</h2><Tooltip helpKey="settings_wordWrapDesc"><button id="base-help">Base help</button></Tooltip>
   <button id="nested" onClick={()=>setNested(true)}>Nested</button>
  </Modal>
  <Modal isOpen={nested} layer="nested" onClose={()=>setNested(false)}>
   <h2>Nested</h2><Tooltip helpKey="settings_wordWrapDesc"><button id="nested-help">Nested help</button></Tooltip>
   <button id="last">Last</button>
  </Modal>
 </div>
}
createRoot(document.getElementById('root')).render(<I18nProvider initialLanguage="en"><Harness/></I18nProvider>);
`
const entryPath = path.join(evidence, 'fixture.tsx')
fs.writeFileSync(entryPath, entry)
const bundled = await build({
  configFile: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  root,
  logLevel: 'error',
  plugins: [tailwindcss()],
  resolve: { alias: { 'react/jsx-runtime': require.resolve('react/jsx-runtime') } },
  build: { write: false, minify: false, lib: { entry: entryPath, name: 'TooltipFixture', formats: ['iife'] } },
})
const output = (Array.isArray(bundled) ? bundled[0] : bundled).output
const code = output.find((file) => file.type === 'chunk')?.code
const css = output
  .filter((file) => file.type === 'asset' && file.fileName.endsWith('.css'))
  .map((file) => file.source)
  .join('\n')
assert(code && css)
fs.writeFileSync(path.join(evidence, 'fixture.js'), code)
fs.writeFileSync(path.join(evidence, 'fixture.css'), css)
const main = path.join(evidence, 'main.cjs')
fs.writeFileSync(
  main,
  `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(evidence, 'profile'))});
app.whenReady().then(async()=>{const window=new BrowserWindow({show:false,width:1920,height:1080,webPreferences:{backgroundThrottling:false,sandbox:true,contextIsolation:true,nodeIntegration:false}});
window.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,cb)=>cb({cancel:true}));
await window.loadURL('data:text/html,<html><body><div id="root"></div></body></html>');});`,
)
let application
const report = { checks: [], errors: [], complete: false }
const record = (check) => report.checks.push(check)
const screenshot = async (file) => {
  const bytes = await application.evaluate(async ({ BrowserWindow }) => [...(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG()])
  fs.writeFileSync(path.join(evidence, file), Buffer.from(bytes))
}
try {
  application = await electron.launch({ executablePath: require('electron'), args: [main, '--disable-gpu'], cwd: root, timeout: 30_000 })
  const page = await application.firstWindow()
  page.setDefaultTimeout(15_000)
  page.on('pageerror', (error) => report.errors.push(error.message))
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: code })
  await page.locator('#edge').waitFor()
  const info = page.locator('#debug button[aria-label="Information"]')
  assert.equal(await page.getByText('Records every step, prompt', { exact: false }).count(), 0)
  await info.focus()
  const tooltip = page.getByRole('tooltip')
  await tooltip.waitFor()
  assert.match(await tooltip.innerText(), /prompt/i)
  assert.equal(await page.locator('[role="alert"]').innerText(), 'Controlled storage error: Retry')
  const id = await tooltip.getAttribute('id')
  assert.equal(await info.getAttribute('aria-describedby'), id)
  const cdp = await page.context().newCDPSession(page)
  const tree = await cdp.send('Accessibility.getFullAXTree')
  assert(tree.nodes.some((node) => node.role?.value === 'tooltip' && !node.ignored))
  assert(tree.nodes.some((node) => node.role?.value === 'button' && /prompt/i.test(node.description?.value || '')))
  record('Accessible description and operational error remain available')
  await page.keyboard.press('Escape')
  await tooltip.waitFor({ state: 'detached' })
  await page.getByRole('switch').click()
  assert.equal(await page.getByRole('switch').getAttribute('aria-checked'), 'true')
  record('Real settings toggle still works')
  await page.locator('#badges [tabindex="0"]').first().focus()
  await tooltip.waitFor()
  assert.match(await tooltip.innerText(), /Ollama/)
  assert(!/unqualified|historical|probe evidence/i.test(await page.locator('#badges').innerText()))
  await page.keyboard.press('Escape')
  record('Runtime badges use central keyboard help without model qualification')

  await page.locator('#edge').hover()
  await tooltip.waitFor()
  await tooltip.hover()
  await page.waitForTimeout(400)
  assert.equal(await tooltip.count(), 1)
  await screenshot('hover-1080p.png')
  record('Hover gap and hovered content remain readable')
  await page.keyboard.press('Escape')
  await page.locator('#italian').click()
  for (const factor of [1, 1.5, 2]) {
    await application.evaluate(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom), factor)
    await page.locator('#edge').focus()
    await tooltip.waitFor()
    assert.match(await tooltip.innerText(), /coordinate/)
    const bounds = await tooltip.boundingBox()
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1)
    await screenshot(`zoom-${factor}.png`)
    await page.keyboard.press('Escape')
    await page.locator('#italian').focus()
  }
  record('Italian help, clipping and viewport bounds at 100/150/200 percent zoom')
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
  await page.locator('#open').click()
  await page.locator('#base-help').focus()
  await tooltip.waitFor()
  assert.equal(await tooltip.evaluate((element) => !!element.closest('[data-tooltip-layer]') && !element.closest('[inert]')), true)
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 1)
  await page.locator('#nested').click()
  await page.locator('#nested-help').focus()
  await tooltip.waitFor()
  assert.equal(await tooltip.evaluate((element) => !element.closest('[inert]')), true)
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 2)
  await page.locator('#last').focus()
  await page.keyboard.press('Tab')
  assert.equal(await page.locator('#nested-help').evaluate((element) => element === document.activeElement), true)
  await page.keyboard.press('Escape') // closes the help reopened by keyboard focus
  await page.keyboard.press('Escape') // closes the nested modal
  assert.equal(await page.getByRole('dialog').count(), 1)
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(await page.locator('#open').evaluate((element) => element === document.activeElement), true)
  record('Nested modal isolation, Tab containment, tooltip-first Escape and focus restoration')
  report.complete = true
  console.log(`PASS: ${report.checks.length} native tooltip checks. Evidence: ${evidence}`)
} finally {
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2))
  if (application) await application.close()
}
