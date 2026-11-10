import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { canConnect, ManagedDevServerRepository } from './managedDevServerRepository'

function listeningRows(port: number): string[] {
  if (process.platform !== 'win32') return []
  try {
    if (!process.env.SystemRoot) throw new Error('SystemRoot is unavailable.')
    return execFileSync(path.join(process.env.SystemRoot, 'System32', 'netstat.exe'), ['-ano', '-p', 'tcp'], {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 5000,
    })
      .split(/\r?\n/)
      .filter((row) => row.trim().split(/\s+/)[1]?.endsWith(`:${port}`))
  } catch (error) {
    return [`Listener snapshot unavailable: ${String(error)}`]
  }
}

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

  it.each(
    process.platform === 'win32'
      ? ['ordinary allocation', 'forced TCP self-connect', 'single readiness success']
      : ['ordinary allocation', 'single readiness success'],
  )(
    'starts a plain Vite dev script on the assigned loopback port: %s',
    async (allocation) => {
      const root = fs.mkdtempSync(path.join(process.cwd(), 'node_modules', 'onlyrag-vite-preview-'))
      const server = new ManagedDevServerRepository()
      const connections: object[] = []
      let ready = false
      let redundantReadinessProbes = 0
      const connect = net.connect
      const connectionSpy = vi.spyOn(net, 'connect').mockImplementation(((options: net.NetConnectOpts) => {
        const target = options as net.TcpNetConnectOpts
        const forceSelfConnect = allocation === 'forced TCP self-connect' && target.host === '127.0.0.2'
        const refuseRedundantProbe = allocation === 'single readiness success' && ready && target.host === '127.0.0.1'
        if (refuseRedundantProbe) redundantReadinessProbes++
        const socket = connect(
          refuseRedundantProbe ? { ...target, port: 0 } : forceSelfConnect ? { ...target, localAddress: target.host, localPort: target.port } : options,
        )
        socket.once('connect', () => {
          if (target.host === '127.0.0.1') ready = true
          const remotePort = socket.remotePort
          connections.push({
            local: socket.address(),
            remoteAddress: socket.remoteAddress,
            remotePort,
            listeners: socket.remoteAddress === '127.0.0.2' && remotePort ? listeningRows(remotePort) : undefined,
          })
        })
        return socket
      }) as typeof net.connect)
      let passed = false
      try {
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }), 'utf-8')
        fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Managed preview</title>', 'utf-8')
        fs.writeFileSync(
          path.join(root, 'vite.config.mjs'),
          "import fs from 'node:fs'; export default { plugins: [{ name: 'listener-receipt', configureServer(server) { server.httpServer.once('listening', () => fs.writeFileSync('listener.json', JSON.stringify({ address: server.httpServer.address(), pid: process.pid }))) } }] }",
          'utf-8',
        )

        const started = await server.start(root)
        const response = await server.probe(root, `http://127.0.0.1:${started.port}/`)

        expect(response.status).toBe(200)
        expect(response.body).toContain('Managed preview')
        const listener = JSON.parse(fs.readFileSync(path.join(root, 'listener.json'), 'utf-8'))
        expect(listener.address).toMatchObject({ address: '127.0.0.1', port: started.port })
        if (allocation === 'forced TCP self-connect') {
          expect(connections).toContainEqual(
            expect.objectContaining({
              local: { address: '127.0.0.2', family: 'IPv4', port: started.port },
              remoteAddress: '127.0.0.2',
              remotePort: started.port,
            }),
          )
        }
        expect(redundantReadinessProbes).toBe(0)
        passed = true
      } catch (error) {
        console.error(
          JSON.stringify({
            root,
            error: String(error),
            connections,
            listener: fs.existsSync(path.join(root, 'listener.json')) ? fs.readFileSync(path.join(root, 'listener.json'), 'utf-8') : null,
          }),
        )
        throw error
      } finally {
        connectionSpy.mockRestore()
        server.stopAll()
        if (passed) fs.rmSync(root, { recursive: true, force: true })
      }
    },
    30_000,
  )

  it.runIf(process.platform === 'win32')('does not mistake a real TCP self-connect for a listening dev server', async () => {
    const reservation = net.createServer()
    await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.2', resolve))
    const address = reservation.address()
    if (!address || typeof address === 'string') throw new Error('Missing reservation address.')
    await new Promise<void>((resolve, reject) => reservation.close((error) => (error ? reject(error) : resolve())))
    const connect = net.connect
    let endpoints: { localAddress?: string; remoteAddress?: string; localPort?: number; remotePort?: number } | undefined
    const connectionSpy = vi.spyOn(net, 'connect').mockImplementation(((options: net.TcpNetConnectOpts) => {
      const socket = connect({ ...options, localAddress: '127.0.0.2', localPort: address.port })
      socket.once('connect', () => {
        endpoints = { localAddress: socket.localAddress, remoteAddress: socket.remoteAddress, localPort: socket.localPort, remotePort: socket.remotePort }
      })
      return socket
    }) as typeof net.connect)
    try {
      expect(await canConnect('127.0.0.2', address.port)).toBe(false)
      expect(endpoints).toEqual({ localAddress: '127.0.0.2', remoteAddress: '127.0.0.2', localPort: address.port, remotePort: address.port })
    } finally {
      connectionSpy.mockRestore()
    }
  })

  it('rejects a workspace without a dev script', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-no-dev-'))
    try {
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { build: 'node build.js' } }), 'utf-8')
      await expect(new ManagedDevServerRepository().start(root)).rejects.toThrow('no dev script')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it.each(['0.0.0.0', '::'])(
    'rejects a dev script that ignores HOST and binds the assigned port on %s',
    async (host) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-wildcard-dev-'))
      const server = new ManagedDevServerRepository()
      try {
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'node server.cjs' } }), 'utf-8')
        fs.writeFileSync(
          path.join(root, 'server.cjs'),
          `require('node:http').createServer((_req, res) => res.end('exposed')).listen(Number(process.env.PORT), '${host}')`,
          'utf-8',
        )
        const error = await server.start(root).catch((error: Error) => error)
        expect(error).toBeInstanceOf(Error)
        expect(String(error)).toContain('must bind only')
        expect(String(error)).toContain('Dev script output:')
        expect(String(error)).toContain('node server.cjs')
        expect(() => server.stop(root)).toThrow('No managed dev server')
      } finally {
        server.stopAll()
        fs.rmSync(root, { recursive: true, force: true })
      }
    },
    20_000,
  )

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
