import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const require = createRequire(import.meta.url)
const execute = promisify(execFile)
// Follow the declared consumers, so a hoisted dependency cannot hide a stale nested copy.
const dependencyRequire = (parent: ReturnType<typeof createRequire>, name: string) => createRequire(parent.resolve(name))
const builderRequire = createRequire(require.resolve('electron-builder/package.json'))
const appBuilderRequire = dependencyRequire(builderRequire, 'app-builder-lib')
const uriRequire = dependencyRequire(appBuilderRequire, 'ajv')
const gypRequire = dependencyRequire(dependencyRequire(appBuilderRequire, '@electron/rebuild'), 'node-gyp')
const cheerioRequire = createRequire(require.resolve('cheerio'))

describe('bounded Zod validation at input boundaries', () => {
  it.each(['array-max', 'array-length', 'set-max', 'set-size', 'map-max', 'map-size', 'object-array'] as const)(
    'rejects oversized %s before visiting any element',
    (kind) => {
      let visits = 0
      const element = z.preprocess((value) => {
        visits++
        return value
      }, z.string())
      const values = Array.from({ length: 10_000 }, (_, index) => String(index))
      const schema = {
        'array-max': z.array(element).max(1),
        'array-length': z.array(element).length(1),
        'set-max': z.set(element).max(1),
        'set-size': z.set(element).size(1),
        'map-max': z.map(element, element).max(1),
        'map-size': z.map(element, element).size(1),
        'object-array': z.object({ items: z.array(element).max(1) }),
      }[kind]
      const input = kind.startsWith('set')
        ? new Set(values)
        : kind.startsWith('map')
          ? new Map(values.map((value) => [value, value]))
          : kind === 'object-array'
            ? { items: values }
            : values
      const result = schema.safeParse(input)
      expect(result.success).toBe(false)
      expect(visits).toBe(0)
      if (!result.success) expect(result.error.issues).toEqual([expect.objectContaining({ code: 'too_big' })])
    },
  )

  it('preserves admitted values and element validation inside the collection limit', () => {
    const schema = z.object({ items: z.array(z.string().min(1)).max(2) })
    expect(schema.parse({ items: ['first', 'second'] })).toEqual({ items: ['first', 'second'] })
    expect(schema.safeParse({ items: [''] }).success).toBe(false)
    expect(schema.safeParse({ items: [1] }).success).toBe(false)
  })
})

it('keeps percent-encoded schemes malformed instead of promoting them to HTTPS', () => {
  const uri = uriRequire('fast-uri') as { parse(value: string): { scheme?: string; error?: string } }
  expect(uri.parse('h%74tps://example.test')).toMatchObject({ scheme: 'h%74tps', error: expect.any(String) })
  expect(uri.parse('https://example.test')).toMatchObject({ scheme: 'https' })
  expect(uri.parse('https://example.test').error).toBeUndefined()
})

it.each(['runtime', 'node-gyp'])('handles excessive encodings without an unhandled error in %s Undici', async (consumer) => {
  const server = createServer((request, response) => {
    if (request.url === '/invalid') {
      response.writeHead(200, { 'content-encoding': 'gzip,gzip,gzip,gzip,gzip,gzip', connection: 'close' })
      response.flushHeaders()
      setTimeout(() => response.destroy(), 20)
    } else {
      response.writeHead(200, { connection: 'close' })
      response.end('admitted-response')
    }
  })
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing owned HTTP listener')
    const resolver = consumer === 'runtime' ? cheerioRequire : gypRequire
    // A fresh process must survive both rejection and a subsequent ordinary request. The
    // vulnerable release can reject fetch and still crash later with an unhandled stream error.
    const probe = `
      const assert = require('node:assert/strict');
      const { fetch } = require(process.argv[1]);
      (async () => {
        await assert.rejects(fetch(process.argv[2] + '/invalid'), error =>
          error.cause?.message.includes('too many content-encodings'));
        const response = await fetch(process.argv[2] + '/valid');
        assert.equal(await response.text(), 'admitted-response');
        setTimeout(() => console.log('BOUNDARY_OK'), 100);
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `
    const result = await execute(process.execPath, ['-e', probe, resolver.resolve('undici'), `http://127.0.0.1:${address.port}`], {
      timeout: 4000,
      windowsHide: true,
    })
    expect(result.stdout.trim()).toBe('BOUNDARY_OK')
    expect(result.stderr).toBe('')
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})
