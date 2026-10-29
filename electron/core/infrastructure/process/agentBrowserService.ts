import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright'
import { redactSecrets } from '../../../logRedactor'
import { workspaceMetadataChildPath } from '../filesystem/workspaceMetadataDirectory'
import { managedDevServerRepository } from './managedDevServerRepository'
import type { ToolExecutionResult } from '../../domain/agent/tools/toolExecutionContracts'
import { logger } from '../logging/logger'

type LocatorType = 'role' | 'label' | 'text' | 'testId' | 'css'
interface BrowserSession {
  browser: Browser
  context: BrowserContext
  page: Page
  workspacePath: string
  port: number
  errors: string[]
  http: string[]
  filledValues: Set<string>
  abortSignal?: AbortSignal
  abortListener?: () => void
}

const MAX_ENTRIES = 20
const MAX_SNAPSHOT_CHARS = 16_000
const MAX_SCREENSHOT_BYTES = 8_000_000
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function runDirectory(workspacePath: string, runId: string): string {
  const hash = createHash('sha256').update(runId).digest('hex')
  return path.join(workspaceMetadataChildPath(workspacePath, 'visual-validation'), hash)
}

function allowedUrl(rawUrl: string, port: number, webSocket = false): boolean {
  try {
    const url = new URL(rawUrl)
    return (
      url.hostname === '127.0.0.1' &&
      Number(url.port) === port &&
      (webSocket ? url.protocol === 'ws:' : url.protocol === 'http:') &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

function failure(message: string): ToolExecutionResult {
  return { outcome: 'failure', outputForHistory: message, logMessage: message.slice(0, 300) }
}

function logCleanupFailure(error: unknown): void {
  logger.log('WARN', 'AgentBrowser', `Browser cleanup failed: ${redactSecrets(String(error)).slice(0, 500)}`)
}

/** One isolated Chromium context per Agent Coding run, restricted to its managed local server. */
export class AgentBrowserService {
  private readonly sessions = new Map<string, BrowserSession>()
  private readonly closing = new Map<string, Promise<void>>()

  constructor(
    private readonly launch: () => Promise<Browser> = async () => {
      try {
        return await chromium.launch({ headless: true, channel: 'chrome' })
      } catch {
        return chromium.launch({ headless: true })
      }
    },
  ) {}

  private async create(runId: string, workspacePath: string, port: number, signal?: AbortSignal): Promise<BrowserSession> {
    const browser = await this.launch()
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        serviceWorkers: 'block',
        acceptDownloads: false,
        permissions: [],
      })
      await context.route('**/*', async (route) => {
        if (!allowedUrl(route.request().url(), port)) {
          await route.abort('blockedbyclient')
          return
        }
        try {
          const response = await route.fetch({ maxRedirects: 0, timeout: 15_000 })
          if (response.status() >= 300 && response.status() < 400) await route.abort('blockedbyclient')
          else await route.fulfill({ response })
        } catch {
          await route.abort('failed')
        }
      })
      await context.routeWebSocket('**/*', (route) => {
        if (allowedUrl(route.url(), port, true)) route.connectToServer()
        else void route.close({ code: 1008, reason: 'External WebSocket blocked' })
      })
      const page = await context.newPage()
      const session: BrowserSession = { browser, context, page, workspacePath, port, errors: [], http: [], filledValues: new Set(), abortSignal: signal }
      page.on('console', (entry) => {
        if (['error', 'warning'].includes(entry.type()) && session.errors.length < MAX_ENTRIES) session.errors.push(redactSecrets(entry.text()).slice(0, 500))
      })
      page.on('pageerror', (error) => {
        if (session.errors.length < MAX_ENTRIES) session.errors.push(redactSecrets(error.message).slice(0, 500))
      })
      page.on('response', (response) => {
        if (response.status() >= 400 && session.http.length < MAX_ENTRIES) {
          session.http.push(`${response.status()} ${redactSecrets(response.url()).slice(0, 500)}`)
        }
      })
      page.on('download', (download) => {
        void download.cancel().catch(logCleanupFailure)
      })
      page.on('dialog', (dialog) => {
        void dialog.dismiss().catch(logCleanupFailure)
      })
      context.on('page', (opened) => {
        if (opened !== page) void opened.close().catch(logCleanupFailure)
      })
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame() && frame.url() !== 'about:blank' && !allowedUrl(frame.url(), port)) void page.close().catch(logCleanupFailure)
      })
      if (signal) {
        session.abortListener = () => {
          void this.closeRun(runId).catch(logCleanupFailure)
        }
        signal.addEventListener('abort', session.abortListener, { once: true })
      }
      this.sessions.set(runId, session)
      if (signal?.aborted) await this.closeRun(runId)
      return session
    } catch (error) {
      await browser.close()
      throw error
    }
  }

  private activeSession(runId: string): BrowserSession | undefined {
    const session = this.sessions.get(runId)
    if (!session) return undefined
    if (session.page.isClosed() || managedDevServerRepository.runningPort(session.workspacePath) !== session.port) {
      void this.closeRun(runId).catch(logCleanupFailure)
      return undefined
    }
    return session
  }

  async navigate(runId: string, workspacePath: string, rawPath: string, signal?: AbortSignal): Promise<ToolExecutionResult> {
    if (!rawPath.startsWith('/') || rawPath.startsWith('//') || rawPath.includes('\\') || rawPath.length > 2048) {
      return failure('browser_navigate requires a path beginning with a single /.')
    }
    const port = managedDevServerRepository.runningPort(workspacePath)
    if (!port) {
      await this.closeRun(runId).catch(logCleanupFailure)
      return failure('Start this workspace managed dev server before using the browser.')
    }
    const target = new URL(rawPath, `http://127.0.0.1:${port}`)
    if (!allowedUrl(target.href, port)) return failure('Browser navigation must remain on the managed dev server origin.')
    try {
      let session = this.sessions.get(runId)
      if (session && (session.port !== port || session.workspacePath !== workspacePath)) {
        await this.closeRun(runId)
        session = undefined
      }
      session ??= await this.create(runId, workspacePath, port, signal)
      if (signal?.aborted) throw new Error('Browser operation cancelled.')
      await session.page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 15_000 })
      return this.snapshot(runId)
    } catch (error) {
      await this.closeRun(runId)
      return failure(`Browser navigation failed: ${redactSecrets(String(error)).slice(0, 500)}`)
    }
  }

  async snapshot(runId: string): Promise<ToolExecutionResult> {
    const session = this.activeSession(runId)
    if (!session) return failure('No active browser page. Call browser_navigate first.')
    try {
      const page = session.page
      const state = await page.evaluate(() => ({
        text: document.body?.innerText.slice(0, 10_000) || '',
        controls: [...document.querySelectorAll('button, a, input, textarea, select, [role]')].slice(0, 80).map((element) => ({
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute('role'),
          label:
            element.getAttribute('aria-label') ||
            element.getAttribute('title') ||
            (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
              ? ''
              : element.textContent?.trim().slice(0, 80)) ||
            '',
          testId: element.getAttribute('data-testid'),
        })),
      }))
      let output = redactSecrets(JSON.stringify({ url: page.url(), title: await page.title(), ...state, errors: session.errors, http: session.http }))
      for (const value of session.filledValues) output = output.replaceAll(value, '[REDACTED]')
      return {
        outcome: 'success',
        outputForHistory: output.slice(0, MAX_SNAPSHOT_CHARS),
        logMessage: 'Browser page inspected.',
        logDetail: output.slice(0, 2000),
      }
    } catch (error) {
      return failure(`Browser snapshot failed: ${redactSecrets(String(error)).slice(0, 500)}`)
    }
  }

  private locator(page: Page, locatorType: LocatorType, selector: string, accessibleName?: string): Locator {
    switch (locatorType) {
      case 'role':
        return page.getByRole(selector as Parameters<Page['getByRole']>[0], { name: accessibleName, exact: true })
      case 'label':
        return page.getByLabel(selector, { exact: true })
      case 'text':
        return page.getByText(selector, { exact: true })
      case 'testId':
        return page.getByTestId(selector)
      case 'css':
        return page.locator(selector)
    }
  }

  async interact(
    runId: string,
    action: 'click' | 'fill',
    locatorType: LocatorType,
    selector: string,
    accessibleName?: string,
    value?: string,
  ): Promise<ToolExecutionResult> {
    const session = this.activeSession(runId)
    if (!session) return failure('No active browser page. Call browser_navigate first.')
    if (!['role', 'label', 'text', 'testId', 'css'].includes(locatorType) || !selector || selector.length > 512) return failure('Invalid browser locator.')
    if (action === 'fill' && (value === undefined || value.length > 10_000)) return failure('Browser fill requires text of at most 10000 characters.')
    try {
      const locator = this.locator(session.page, locatorType, selector, accessibleName)
      const count = await locator.count()
      if (count !== 1) return failure(`Browser locator matched ${count} elements; exactly one is required.`)
      if (action === 'click') await locator.click({ timeout: 10_000 })
      else {
        await locator.fill(value || '', { timeout: 10_000 })
        if (value) session.filledValues.add(value)
      }
      const result = await this.snapshot(runId)
      return result.outcome === 'success' ? { ...result, logMessage: action === 'click' ? 'Browser element clicked.' : 'Browser field filled.' } : result
    } catch (error) {
      return failure(`Browser ${action} failed: ${redactSecrets(String(error)).slice(0, 500)}`)
    }
  }

  async screenshot(runId: string): Promise<ToolExecutionResult> {
    const session = this.activeSession(runId)
    if (!session) return failure('No active browser page. Call browser_navigate first.')
    const screenshotId = randomUUID()
    const outputDir = runDirectory(session.workspacePath, runId)
    fs.mkdirSync(outputDir, { recursive: true })
    const metadataRoot = fs.realpathSync.native(path.join(session.workspacePath, '.onlyrag'))
    if (fs.lstatSync(outputDir).isSymbolicLink() || !fs.realpathSync.native(outputDir).startsWith(`${metadataRoot}${path.sep}`)) {
      return failure('Unsafe browser screenshot directory.')
    }
    const outputPath = path.join(outputDir, `${screenshotId}.png`)
    try {
      const png = await session.page.screenshot({
        timeout: 15_000,
        animations: 'disabled',
        mask: [session.page.locator('input, textarea, select, [contenteditable]')],
      })
      if (png.length > MAX_SCREENSHOT_BYTES) return failure('Browser screenshot exceeds the 8 MB limit.')
      fs.writeFileSync(outputPath, png, { flag: 'wx' })
      return {
        outcome: 'success',
        outputForHistory: `Browser screenshot captured: ${screenshotId}.`,
        logMessage: 'Browser screenshot captured.',
        browserScreenshot: { workspacePath: session.workspacePath, runId, screenshotId },
      }
    } catch (error) {
      return failure(`Browser screenshot failed: ${redactSecrets(String(error)).slice(0, 500)}`)
    }
  }

  async closeRun(runId: string): Promise<void> {
    const pending = this.closing.get(runId)
    if (pending) return pending
    const session = this.sessions.get(runId)
    if (!session) return
    this.sessions.delete(runId)
    if (session.abortSignal && session.abortListener) session.abortSignal.removeEventListener('abort', session.abortListener)
    const closing = session.browser.close()
    this.closing.set(runId, closing)
    try {
      await closing
    } finally {
      this.closing.delete(runId)
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((runId) => this.closeRun(runId)).concat([...this.closing.values()]))
  }

  async closeWorkspace(workspacePath: string): Promise<void> {
    await Promise.all([...this.sessions.entries()].filter(([, session]) => session.workspacePath === workspacePath).map(([runId]) => this.closeRun(runId)))
  }
}

/** Reads only screenshots created by the browser tool for a specific run. */
export function readAgentBrowserScreenshot(workspacePath: string, runId: string, screenshotId: string): string | null {
  if (!/^[a-f0-9-]{36}$/.test(screenshotId)) return null
  if (fs.lstatSync(path.join(workspacePath, '.onlyrag')).isSymbolicLink()) return null
  const metadataRoot = fs.realpathSync.native(path.join(workspacePath, '.onlyrag'))
  const directory = path.join(metadataRoot, 'visual-validation', createHash('sha256').update(runId).digest('hex'))
  const candidate = path.join(directory, `${screenshotId}.png`)
  if (!fs.existsSync(candidate) || fs.lstatSync(directory).isSymbolicLink() || fs.lstatSync(candidate).isSymbolicLink()) return null
  const realDirectory = fs.realpathSync.native(directory)
  const realCandidate = fs.realpathSync.native(candidate)
  if (!realDirectory.startsWith(`${metadataRoot}${path.sep}`) || !realCandidate.startsWith(`${realDirectory}${path.sep}`)) return null
  const stat = fs.statSync(realCandidate)
  if (!stat.isFile() || stat.size > MAX_SCREENSHOT_BYTES) return null
  const bytes = fs.readFileSync(realCandidate)
  return bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC) ? bytes.toString('base64') : null
}

export const agentBrowserService = new AgentBrowserService()
