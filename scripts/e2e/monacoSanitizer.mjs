import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { _electron as electron } from 'playwright'
import { monacoSanitizerPlugin } from '../monacoSanitizerPlugin.mts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-monaco-sanitizer-'))
const modulePath = (relative) => JSON.stringify(path.join(root, relative).replace(/\\/g, '/'))
const entry = `
import purify from ${modulePath('node_modules/dompurify/dist/purify.es.mjs')};
export { sanitizeHtml, safeSetInnerHtml } from ${modulePath('node_modules/monaco-editor/esm/vs/base/browser/domSanitize.js')};
export { renderMarkdown } from ${modulePath('node_modules/monaco-editor/esm/vs/base/browser/markdownRenderer.js')};
export const version = purify.version;
export const configs = [];
const sanitize = purify.sanitize;
purify.sanitize = function(value, config) {
 configs.push({inPlace: config?.IN_PLACE ?? false, safeTemplates: config?.SAFE_FOR_TEMPLATES ?? false,
   parser: config?.PARSER_MEDIA_TYPE ?? 'text/html', domFragment: config?.RETURN_DOM_FRAGMENT ?? false});
 return sanitize.call(purify, value, config);
};
`
const entryPath = path.join(evidence, 'entry.mjs')
fs.writeFileSync(entryPath, entry)
const bundled = await build({
  configFile: false,
  root,
  logLevel: 'error',
  plugins: [monacoSanitizerPlugin()],
  build: { write: false, minify: false, lib: { entry: entryPath, name: 'SanitizerProbe', formats: ['iife'] } },
})
const output = (Array.isArray(bundled) ? bundled[0] : bundled).output
const code = output.find((file) => file.type === 'chunk')?.code
assert(code && code.includes('3.4.17'))
assert(!code.includes('DOMPurify 3.4.8'))
fs.writeFileSync(path.join(evidence, 'probe.js'), code)
const main = path.join(evidence, 'main.cjs')
fs.writeFileSync(
  main,
  `const {app,BrowserWindow}=require('electron');
app.setPath('userData', ${JSON.stringify(path.join(evidence, 'profile'))});
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
 window.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,callback)=>callback({cancel:true}));
 await window.loadURL('data:text/html,<html><body></body></html>');
});`,
)
let application
try {
  application = await electron.launch({ executablePath: require('electron'), args: [main, '--disable-gpu'], cwd: root, timeout: 30_000 })
  const page = await application.firstWindow()
  await page.waitForLoadState('load')
  await page.evaluate(code)
  const report = await page.evaluate(() => {
    const probe = globalThis.SanitizerProbe
    const container = document.createElement('div')
    document.body.append(container)
    const cases = []
    const verify = (name, html) => {
      probe.safeSetInnerHtml(container, html)
      const forbidden = [...container.querySelectorAll('*')].flatMap((node) =>
        [...node.attributes].filter((attr) => /^on/i.test(attr.name) || /javascript:/i.test(attr.value)).map((attr) => attr.name),
      )
      cases.push({ name, html: container.innerHTML, forbidden, script: !!container.querySelector('script,svg,animate,template,iframe') })
    }
    verify('scripts-and-handlers', '<b>safe</b><script>globalThis.compromised=1</script><img src="javascript:alert(1)" onerror="globalThis.compromised=1">')
    verify('smil-svg-excluded', '<svg><animate attributeName="href" values="javascript:alert(1)"/></svg><p>safe</p>')
    verify('template-excluded', '<template shadowrootmode="open"><span>{{unsafe}}</span><img onerror="globalThis.compromised=1"></template><p>safe</p>')
    verify('safe-links', '<a href="https://example.test/path">safe link</a><a href="javascript:alert(1)">unsafe link</a>')
    const rendered = probe.renderMarkdown({
      value: '**valid** [unsafe](javascript:alert(1))\n\n<img src=x onerror="globalThis.compromised=1">',
      isTrusted: false,
      supportHtml: false,
    })
    container.replaceChildren(rendered.element)
    const markdown = {
      bold: container.querySelector('strong')?.textContent,
      scripts: container.querySelectorAll('script,img').length,
      html: container.innerHTML,
    }
    rendered.dispose()
    return {
      version: probe.version,
      configs: probe.configs,
      cases,
      markdown,
      compromised: globalThis.compromised === true || globalThis.compromised === 1,
      chromium: navigator.userAgent,
    }
  })
  assert.equal(report.version, '3.4.17')
  assert(report.configs.length >= 5)
  assert(report.configs.some((config) => config.domFragment))
  assert(report.configs.every((config) => !config.inPlace && !config.safeTemplates && config.parser === 'text/html'))
  for (const test of report.cases) {
    assert.deepEqual(test.forbidden, [], test.name)
    assert.equal(test.script, false, test.name)
    assert(test.html.includes('safe'), test.name)
  }
  assert(report.cases.find((test) => test.name === 'safe-links').html.includes('https://example.test/path'))
  assert.equal(report.markdown.bold, 'valid')
  assert.equal(report.markdown.scripts, 0)
  assert.equal(report.compromised, false)
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`PASS: native Monaco sanitizer and Markdown rendering; ${evidence}`)
} finally {
  await application?.close()
}
