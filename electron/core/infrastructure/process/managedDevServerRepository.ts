import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

interface OwnedServer {
  process: ChildProcess
  port: number
  output: string
}

const MAX_OUTPUT_CHARS = 4000
const MAX_PROBE_BODY_CHARS = 8000
const LOOPBACK_HOST = '127.0.0.1'

async function availablePort(): Promise<number> {
  const reservation = net.createServer()
  return new Promise((resolve, reject) => {
    reservation.once('error', reject)
    reservation.listen(0, LOOPBACK_HOST, () => {
      const address = reservation.address()
      reservation.close((error) => {
        if (error) reject(error)
        else if (!address || typeof address === 'string') reject(new Error('Could not assign a dev server port.'))
        else resolve(address.port)
      })
    })
  })
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 300 })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
  })
}

async function assertLoopbackOnly(port: number): Promise<void> {
  const exposedAddresses = new Set<string>(['127.0.0.2'])
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (!address.internal) exposedAddresses.add(address.address)
    }
  }
  for (const address of exposedAddresses) {
    if (await canConnect(address, port)) {
      throw new Error(`The dev script exposed port ${port} on ${address}; it must bind only to ${LOOPBACK_HOST}.`)
    }
  }
}

function workspaceKey(workspacePath: string): string {
  const resolved = fs.realpathSync.native(workspacePath)
  if (!fs.statSync(resolved).isDirectory()) throw new Error('A project workspace directory is required.')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** Owns only processes started from a workspace's package.json dev script. */
export class ManagedDevServerRepository {
  private readonly servers = new Map<string, OwnedServer>()

  constructor(private readonly startupTimeoutMs = 15_000) {}

  async start(workspacePath: string): Promise<{ pid: number; port: number; output: string }> {
    const key = workspaceKey(workspacePath)
    if (this.servers.has(key)) throw new Error('A managed dev server is already running for this workspace.')
    const manifestPath = path.join(workspacePath, 'package.json')
    if (fs.realpathSync.native(manifestPath) !== path.join(fs.realpathSync.native(workspacePath), 'package.json')) {
      throw new Error('The workspace package.json must not be a symlink.')
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { scripts?: { dev?: unknown } }
    if (typeof manifest.scripts?.dev !== 'string' || !manifest.scripts.dev.trim()) {
      throw new Error('The workspace package.json has no dev script.')
    }

    const port = await availablePort()
    const env = { ...process.env, HOST: LOOPBACK_HOST, PORT: String(port) }
    const viteScript = /^vite(?:\s+(?:dev|serve))?$/.test(manifest.scripts.dev.trim())
    const args = viteScript ? ['run', 'dev', '--', '--host', LOOPBACK_HOST, '--port', String(port), '--strictPort'] : ['run', 'dev']
    const windows = process.platform === 'win32'
    const child = windows
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], {
          cwd: workspacePath,
          env,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      : spawn('npm', args, {
          cwd: workspacePath,
          env,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
    const owned: OwnedServer = { process: child, port, output: '' }
    const append = (chunk: Buffer) => {
      owned.output = (owned.output + chunk.toString('utf-8')).slice(-MAX_OUTPUT_CHARS)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    if (!child.pid) throw new Error('The dev server did not start.')
    child.once('exit', () => {
      if (this.servers.get(key) === owned) this.servers.delete(key)
    })
    try {
      const deadline = Date.now() + this.startupTimeoutMs
      while (Date.now() < deadline && !(await canConnect(LOOPBACK_HOST, port))) {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`The dev script exited before listening on ${LOOPBACK_HOST}:${port}.\n${owned.output}`)
        }
        await delay(100)
      }
      if (!(await canConnect(LOOPBACK_HOST, port))) {
        throw new Error(`The dev script did not listen on ${LOOPBACK_HOST}:${port} within ${this.startupTimeoutMs} ms.\n${owned.output}`)
      }
      await assertLoopbackOnly(port)
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`The dev script exited after opening ${LOOPBACK_HOST}:${port}.\n${owned.output}`)
      }
      this.servers.set(key, owned)
      return { pid: child.pid, port, output: owned.output }
    } catch (error) {
      this.stopOwned(child)
      throw error
    }
  }

  stop(workspacePath: string): { pid: number; output: string } {
    const key = workspaceKey(workspacePath)
    const owned = this.servers.get(key)
    if (!owned?.process.pid) throw new Error('No managed dev server is running for this workspace.')
    this.stopOwned(owned.process)
    this.servers.delete(key)
    return { pid: owned.process.pid, output: owned.output }
  }

  stopAll(): void {
    for (const owned of this.servers.values()) this.stopOwned(owned.process)
    this.servers.clear()
  }

  private stopOwned(child: ChildProcess): void {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' })
    } else {
      process.kill(-child.pid, 'SIGTERM')
    }
  }

  async probe(workspacePath: string, rawUrl: string): Promise<{ status: number; body: string; truncated: boolean }> {
    const owned = this.servers.get(workspaceKey(workspacePath))
    if (!owned) throw new Error('Start this workspace dev server before probing it.')
    const url = new URL(rawUrl)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !url.port ||
      Number(url.port) !== owned.port ||
      url.username ||
      url.password
    ) {
      throw new Error(`Only an explicit HTTP(S) loopback URL on the managed port ${owned.port} is allowed.`)
    }
    await assertLoopbackOnly(owned.port)
    const transport = url.protocol === 'https:' ? https : http
    const hostname = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname === '[::1]' ? '::1' : url.hostname
    return new Promise((resolve, reject) => {
      const request = transport.get(
        { hostname, port: Number(url.port), path: `${url.pathname}${url.search}`, timeout: 5000, headers: { Host: url.host } },
        (response) => {
          let body = ''
          let truncated = false
          response.setEncoding('utf-8')
          response.on('data', (chunk: string) => {
            const available = MAX_PROBE_BODY_CHARS - body.length
            if (available > 0) body += chunk.slice(0, available)
            if (chunk.length > available) truncated = true
          })
          response.on('end', () => resolve({ status: response.statusCode || 0, body, truncated }))
          response.on('error', reject)
        },
      )
      request.on('timeout', () => request.destroy(new Error('Local HTTP probe timed out.')))
      request.on('error', reject)
    })
  }
}

export const managedDevServerRepository = new ManagedDevServerRepository()
