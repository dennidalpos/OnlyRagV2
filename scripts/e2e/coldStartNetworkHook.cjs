const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const { app, session, net } = require('electron')

const auditPath = process.env.ONLYRAG_E2E_NETWORK_AUDIT_PATH
if (!auditPath) throw new Error('Missing cold-start network audit path')
fs.writeFileSync(auditPath, '')

const isExternal = (address) => {
  try {
    const url = new URL(address)
    return ['http:', 'https:'].includes(url.protocol) && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}
const record = (source, address) => {
  if (!isExternal(address)) return false
  fs.appendFileSync(auditPath, JSON.stringify({ source, address }) + '\n')
  return true
}
const requestUrl = (input, options, protocol) => {
  if (typeof input === 'string' || input instanceof URL) return new URL(input, `${protocol}://localhost`).href
  const target = { ...input, ...options }
  return `${target.protocol || `${protocol}:`}//${target.hostname || target.host || 'localhost'}${target.port ? `:${target.port}` : ''}${target.path || target.pathname || '/'}`
}
for (const [module, protocol] of [
  [http, 'http'],
  [https, 'https'],
]) {
  for (const method of ['request', 'get']) {
    const original = module[method]
    module[method] = function (input, options, ...rest) {
      const address = requestUrl(input, options, protocol)
      if (record(`node:${protocol}.${method}`, address)) throw new Error(`Blocked external startup request: ${address}`)
      return original.call(this, input, options, ...rest)
    }
  }
}
const originalFetch = globalThis.fetch
globalThis.fetch = function (input, ...rest) {
  const address = typeof input === 'string' || input instanceof URL ? String(input) : input.url
  if (record('node:fetch', address)) return Promise.reject(new Error(`Blocked external startup fetch: ${address}`))
  return originalFetch.call(this, input, ...rest)
}
if (net?.request) {
  const originalRequest = net.request
  net.request = function (input, ...rest) {
    const address = typeof input === 'string' ? input : input.url
    if (record('electron:net', address)) throw new Error(`Blocked external startup request: ${address}`)
    return originalRequest.call(this, input, ...rest)
  }
}
app.on('ready', () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: record('chromium', details.url) })
  })
})
