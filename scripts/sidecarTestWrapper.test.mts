import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Runs the real `npm run test:sidecar` wrapper against a controlled fake interpreter: the ordinary
// Sidecar suite must always be executed (never replaced by live requests to port 8000) and its exit
// status propagated, with missing pytest failing clearly.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const script = path.join(root, 'scripts', 'test_sidecar_health.ps1')
const SIDECAR_PORT = 8000
const TIMEOUT_MS = 60_000

interface RunResult {
  code: number | null
  output: string
}

function runPowerShell(args: string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], {
      cwd: root,
      env: { ...process.env, ...env },
      windowsHide: true,
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS - 5_000)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, output })
    })
  })
}

describe.runIf(process.platform === 'win32')('Sidecar test wrapper', () => {
  let fixture: string
  let fakePython: string
  let invocationLog: string

  beforeAll(() => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-sidecar-wrapper-'))
    fakePython = path.join(fixture, 'python.cmd')
    fs.writeFileSync(
      fakePython,
      [
        '@echo off',
        '>>"%ONLYRAG_FAKE_PYTHON_LOG%" echo cwd=%CD% args=%*',
        // Like a real interpreter, write diagnostics to stderr: PowerShell must not turn them into its own exit code.
        'if "%~3"=="--version" (',
        '  if not "%ONLYRAG_FAKE_PYTEST_VERSION_EXIT%"=="0" echo No module named pytest 1>&2',
        '  exit /b %ONLYRAG_FAKE_PYTEST_VERSION_EXIT%',
        ')',
        'echo fake suite diagnostic on stderr 1>&2',
        'exit /b %ONLYRAG_FAKE_PYTEST_EXIT%',
        '',
      ].join('\r\n'),
    )
  })

  afterAll(() => {
    const directory = fs.realpathSync.native(fixture)
    if (!path.basename(directory).startsWith('onlyrag-sidecar-wrapper-')) throw new Error('Refusing cleanup outside the owned fixture')
    fs.rmSync(directory, { recursive: true, force: true })
  })

  beforeEach(() => {
    invocationLog = path.join(fixture, `calls-${Date.now()}-${Math.random().toString(16).slice(2)}.log`)
  })

  afterEach(() => {
    fs.rmSync(invocationLog, { force: true })
  })

  const invocations = () => (fs.existsSync(invocationLog) ? fs.readFileSync(invocationLog, 'utf8').trim().split(/\r?\n/) : [])

  function runWrapper(options: { versionExit?: number; suiteExit?: number; pythonExe?: string } = {}) {
    return runPowerShell(['-File', script, '-PythonExe', options.pythonExe ?? fakePython], {
      ONLYRAG_FAKE_PYTHON_LOG: invocationLog,
      ONLYRAG_FAKE_PYTEST_VERSION_EXIT: String(options.versionExit ?? 0),
      ONLYRAG_FAKE_PYTEST_EXIT: String(options.suiteExit ?? 0),
    })
  }

  /** Binds 127.0.0.1:8000 when free; an existing foreign listener keeps the port occupied but unobservable. */
  async function withSidecarPortListener<T>(body: (observed: { owned: boolean; connections: () => number }) => Promise<T>): Promise<T> {
    let connections = 0
    const server = net.createServer((socket) => {
      connections += 1
      socket.destroy()
    })
    const owned = await new Promise<boolean>((resolve, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) => (error.code === 'EADDRINUSE' ? resolve(false) : reject(error)))
      server.listen(SIDECAR_PORT, '127.0.0.1', () => resolve(true))
    })
    try {
      return await body({ owned, connections: () => connections })
    } finally {
      if (owned) await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }

  it(
    'counts a real loopback connection, so the zero-request assertions below are meaningful',
    async () => {
      await withSidecarPortListener(async ({ owned, connections }) => {
        if (!owned) return
        const probe = await runPowerShell(
          ['-Command', `try { (New-Object Net.Sockets.TcpClient).Connect('127.0.0.1', ${SIDECAR_PORT}); exit 0 } catch { exit 1 }`],
          {},
        )
        expect(probe.code).toBe(0)
        await new Promise((resolve) => setTimeout(resolve, 200))
        expect(connections()).toBe(1)
      })
    },
    TIMEOUT_MS,
  )

  it.each([0, 1])(
    'runs the ordinary suite and propagates exit %i while port 8000 is occupied, without contacting it',
    async (suiteExit) => {
      await withSidecarPortListener(async ({ owned, connections }) => {
        const result = await runWrapper({ suiteExit })
        expect(result.code, result.output).toBe(suiteExit)
        const calls = invocations()
        expect(calls).toHaveLength(2)
        expect(calls[0]).toMatch(/args=-m pytest --version$/)
        expect(calls[1]).toMatch(/args=-m pytest -q$/)
        expect(calls[1].toLowerCase()).toContain(`cwd=${root.toLowerCase()} `)
        if (owned) {
          await new Promise((resolve) => setTimeout(resolve, 200))
          expect(connections()).toBe(0)
        }
      })
    },
    TIMEOUT_MS,
  )

  it.each([0, 1, 5])(
    'runs the ordinary suite and propagates exit %i without a listener owned by the test',
    async (suiteExit) => {
      const result = await runWrapper({ suiteExit })
      expect(result.code, result.output).toBe(suiteExit)
      expect(invocations().at(-1)).toMatch(/args=-m pytest -q$/)
    },
    TIMEOUT_MS,
  )

  it(
    'fails clearly without running the suite when pytest is missing',
    async () => {
      const result = await runWrapper({ versionExit: 1 })
      expect(result.code).toBe(2)
      expect(result.output).toContain('pytest non disponibile')
      expect(invocations()).toEqual([expect.stringMatching(/args=-m pytest --version$/)])
    },
    TIMEOUT_MS,
  )

  it(
    'fails clearly when the interpreter does not exist',
    async () => {
      const result = await runWrapper({ pythonExe: path.join(fixture, 'missing', 'python.exe') })
      expect(result.code).toBe(2)
      expect(result.output).toContain('Interprete Python non trovato')
      expect(invocations()).toEqual([])
    },
    TIMEOUT_MS,
  )

  it('contains no live-service request path', () => {
    const source = fs.readFileSync(script, 'utf8')
    expect(source).not.toMatch(/Invoke-RestMethod|Invoke-WebRequest|Net\.WebClient|HttpClient|TcpClient/i)
    expect(source).not.toMatch(/:8000|127\.0\.0\.1|localhost/i)
  })
})
