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
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-setup-disk-'))
const source = (relative) => JSON.stringify(path.join(root, relative).replaceAll('\\', '/'))
const entry = path.join(evidence, 'fixture.tsx')
fs.writeFileSync(
  entry,
  `
import React from ${source('node_modules/react/index.js')};
import {createRoot} from ${source('node_modules/react-dom/client.js')};
import {HardwareSetupWizardModal} from ${source('src/components/common/HardwareSetupWizardModal.tsx')};
import {DEFAULT_APP_SETTINGS} from ${source('shared/domain/settings/appSettingsDefaults.ts')};
import {I18nProvider} from ${source('src/i18n/index.ts')};
import ${source('src/index.css')};
createRoot(document.getElementById('root')).render(<I18nProvider initialLanguage="en"><HardwareSetupWizardModal
 isOpen onClose={()=>{}} diagnostics={null} settings={DEFAULT_APP_SETTINGS} onUpdateSettings={()=>{}} onRefreshDiagnostics={()=>{}} /></I18nProvider>);
`,
)
const bundled = await build({
  configFile: false,
  root,
  logLevel: 'error',
  plugins: [tailwindcss()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: { alias: { 'react/jsx-runtime': require.resolve('react/jsx-runtime') } },
  build: { write: false, minify: false, lib: { entry, name: 'DiskFixture', formats: ['iife'] } },
})
const output = (Array.isArray(bundled) ? bundled[0] : bundled).output
const code = output.find((item) => item.type === 'chunk')?.code
const css = output
  .filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
  .map((item) => item.source)
  .join('\n')
assert(code && css)
const preload = path.join(evidence, 'preload.cjs')
fs.writeFileSync(
  preload,
  `const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
 checkDiskSpace: p=>ipcRenderer.invoke('fixture:disk',p),
 pullOllamaModel: p=>ipcRenderer.invoke('fixture:pull',p),
 getOllamaModelMetrics: async()=>({})
});`,
)
const main = path.join(evidence, 'main.cjs')
fs.writeFileSync(
  main,
  `
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),ts=require(${JSON.stringify(require.resolve('typescript'))});
app.setPath('userData',${JSON.stringify(path.join(evidence, 'profile'))});
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
global.fixture={mode:'error',probes:[],pulls:[],refused:[],results:[]};
for(const protocol of ['node:http','node:https'])for(const method of ['request','get'])require(protocol)[method]=(...args)=>{
 global.fixture.refused.push(String(args[0]));throw Error('Unexpected native network');};
process.env.OLLAMA_MODELS='Z:\\\\onlyrag-fixture-models\\\\new';
const stat=fs.statSync,statfs=fs.statfsSync;
fs.statSync=(p,...args)=>{
 if(String(p).startsWith('Z:')) {
  if(String(p)==='Z:\\\\')return {isDirectory:()=>true};
  throw Object.assign(Error('fixture missing destination'),{code:'ENOENT'});
 }
 return stat(p,...args);
};
fs.statfsSync=(p,...args)=>{
 if(String(p).startsWith('Z:')) {
  global.fixture.probes.push(p);
  if(global.fixture.mode==='error')throw Object.assign(Error('fixture disk unavailable'),{code:'EACCES'});
  return {bavail:global.fixture.mode==='insufficient'?1:100,blocks:200,bsize:1024**3};
 }
 return statfs(p,...args);
};
const {systemAppService}=require(${source('electron/core/application/systemAppService.ts')});
ipcMain.handle('fixture:disk',(_,p)=>{
 const result=systemAppService.validateModelDownloadSpace(p.models);global.fixture.results.push(result);return result;
});
ipcMain.handle('fixture:pull',(_,p)=>{global.fixture.pulls.push(p);return {success:false,error:'Controlled stop after admission'};});
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false,width:1920,height:1080,webPreferences:{preload:${JSON.stringify(preload)},sandbox:true,contextIsolation:true,nodeIntegration:false}});
 window.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(request,callback)=>{
  global.fixture.refused.push(request.url);callback({cancel:true});
 });
 await window.loadURL('data:text/html,<html><body><div id="root"></div></body></html>');
});
`,
)
let application
const report = { complete: false, checks: [], errors: [], evidence }
try {
  application = await electron.launch({ executablePath: require('electron'), args: [main, '--disable-gpu'], cwd: root, timeout: 30_000 })
  const page = await application.firstWindow()
  page.setDefaultTimeout(15_000)
  page.on('pageerror', (error) => report.errors.push(error.message))
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: code })
  await page.getByRole('button', { name: /1.click/i }).click()
  const download = page.getByRole('button', { name: /confirm.*download/i })
  await page.getByRole('alert').waitFor()
  assert.equal(await download.isDisabled(), true)
  assert.match(await page.getByRole('alert').innerText(), /measurement unavailable/i)
  let state = await application.evaluate(() => global.fixture)
  assert.deepEqual(state.results[0].freeGB, null)
  assert.deepEqual(state.probes, ['Z:\\'])
  assert.equal(state.pulls.length, 0)
  report.checks.push('Missing configured Z: destination probes its ancestor only; unavailable measurement blocks native wizard')
  await application.evaluate(() => {
    global.fixture.mode = 'insufficient'
  })
  await page.getByRole('button', { name: /retry/i }).click()
  await page
    .getByRole('alert')
    .filter({ hasText: /insufficient/i })
    .waitFor()
  assert.equal(await download.isDisabled(), true)
  report.checks.push('Insufficient measured space remains visible and blocks downloads')
  await application.evaluate(() => {
    global.fixture.mode = 'available'
  })
  const retry = page.getByRole('button', { name: /retry/i })
  await retry.focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find((b) => /confirm.*download/i.test(b.textContent))?.disabled)
  assert.equal(await download.isDisabled(), false)
  const cdp = await page.context().newCDPSession(page)
  const tree = await cdp.send('Accessibility.getFullAXTree')
  assert(tree.nodes.some((node) => node.role?.value === 'button' && /confirm.*download/i.test(node.name?.value || '') && !node.ignored))
  const bytes = await application.evaluate(async ({ BrowserWindow }) => [...(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG()])
  fs.writeFileSync(path.join(evidence, 'recovered-1080p.png'), Buffer.from(bytes))
  await download.click()
  await page.getByText('Controlled stop after admission', { exact: false }).first().waitFor()
  state = await application.evaluate(() => global.fixture)
  assert.equal(state.pulls.length, 1)
  assert(state.probes.length === 3 && state.probes.every((p) => p === 'Z:\\'))
  assert.deepEqual(state.refused, [])
  assert.deepEqual(report.errors, [])
  report.checks.push('Keyboard retry recovers admission; accessible confirmation dispatches one controlled pull with no network')
  report.state = state
  report.complete = true
  console.log(JSON.stringify(report, null, 2))
} finally {
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2))
  if (application) await application.close()
  console.log('Evidence: ' + evidence)
}
