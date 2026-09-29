import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ManagedDevServerRepository } from './managedDevServerRepository'

describe('managed dev server tools', () => {
  it('starts only the workspace dev script, probes loopback and stops only its owned process', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-managed-dev-'))
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-other-dev-'))
    const server = new ManagedDevServerRepository()
    try {
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'node server.cjs' } }), 'utf-8')
      fs.writeFileSync(
        path.join(root, 'server.cjs'),
        "const fs = require('node:fs'); const http = require('node:http'); const server = http.createServer((req, res) => res.end('ready')); server.listen(Number(process.env.PORT), process.env.HOST, () => fs.writeFileSync('port.txt', String(server.address().port)));",
        'utf-8',
      )
      const started = await server.start(root)
      await vi.waitFor(() => expect(fs.existsSync(path.join(root, 'port.txt'))).toBe(true), { timeout: 10_000 })
      const port = Number(fs.readFileSync(path.join(root, 'port.txt'), 'utf-8'))
      expect(started.port).toBe(port)
      expect(await server.probe(root, `http://localhost:${port}/health`)).toEqual({ status: 200, body: 'ready', truncated: false })
      await expect(server.probe(root, `http://example.com:${port}/`)).rejects.toThrow('loopback')
      await expect(server.probe(root, `http://127.0.0.1:${port}@example.com/`)).rejects.toThrow('loopback')
      const unrelated = http.createServer((_request, response) => response.end('other'))
      await new Promise<void>((resolve) => unrelated.listen(0, '127.0.0.1', resolve))
      try {
        const address = unrelated.address()
        if (!address || typeof address === 'string') throw new Error('Unrelated test server has no port.')
        await expect(server.probe(root, `http://127.0.0.1:${address.port}/`)).rejects.toThrow('managed port')
      } finally {
        unrelated.close()
      }
      await expect(server.probe(other, `http://127.0.0.1:${port}/`)).rejects.toThrow('Start this workspace')
      expect(() => server.stop(other)).toThrow('No managed dev server')
      expect(server.stop(root).pid).toBeGreaterThan(0)
      expect(() => server.stop(root)).toThrow('No managed dev server')
    } finally {
      server.stopAll()
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(other, { recursive: true, force: true })
    }
  }, 20_000)

  it('starts a plain Vite dev script on the assigned loopback port', async () => {
    const root = fs.mkdtempSync(path.join(process.cwd(), 'node_modules', 'onlyrag-vite-preview-'))
    const server = new ManagedDevServerRepository()
    try {
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }), 'utf-8')
      fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Managed preview</title>', 'utf-8')

      const started = await server.start(root)
      const response = await server.probe(root, `http://127.0.0.1:${started.port}/`)

      expect(response.status).toBe(200)
      expect(response.body).toContain('Managed preview')
    } finally {
      server.stopAll()
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('rejects a workspace without a dev script', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-no-dev-'))
    try {
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { build: 'node build.js' } }), 'utf-8')
      await expect(new ManagedDevServerRepository().start(root)).rejects.toThrow('no dev script')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a dev script that ignores HOST and binds the assigned port on all interfaces', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-wildcard-dev-'))
    const server = new ManagedDevServerRepository()
    try {
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'node server.cjs' } }), 'utf-8')
      fs.writeFileSync(
        path.join(root, 'server.cjs'),
        "require('node:http').createServer((_req, res) => res.end('exposed')).listen(Number(process.env.PORT), '0.0.0.0')",
        'utf-8',
      )
      await expect(server.start(root)).rejects.toThrow('must bind only')
      expect(() => server.stop(root)).toThrow('No managed dev server')
    } finally {
      server.stopAll()
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 20_000)

  it('rejects a dev script that ignores the assigned PORT', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-wrong-port-dev-'))
    const server = new ManagedDevServerRepository(1_000)
    try {
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'node server.cjs' } }), 'utf-8')
      fs.writeFileSync(path.join(root, 'server.cjs'), "require('node:http').createServer().listen(0, process.env.HOST)", 'utf-8')
      await expect(server.start(root)).rejects.toThrow('did not listen')
    } finally {
      server.stopAll()
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 10_000)
})
