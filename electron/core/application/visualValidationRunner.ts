import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { validatePathSafety } from '../domain/agent/contextFilter'
import { visualValidationRequestSchema } from '../domain/agent/visualValidationContracts'

interface PageLike {
  goto(url: string, options: { waitUntil: 'load'; timeout: number }): Promise<unknown>
  screenshot(options: { path: string; timeout: number }): Promise<unknown>
  content(): Promise<string>
  on?(event: 'console' | 'response', listener: (payload: unknown) => void): void
}

interface BrowserContextLike {
  newPage(): Promise<PageLike>
}

interface BrowserLike {
  newContext(options: { viewport: { width: number; height: number } }): Promise<BrowserContextLike>
  close(): Promise<void>
}

export type VisualValidationLaunchResult =
  | { status: 'ready'; artifactPath: string; browser: BrowserLike; context: BrowserContextLike; page: PageLike; close: () => Promise<void>; consoleEntries: VisualValidationEvidence['console']; httpEntries: VisualValidationEvidence['http']; redactedFields: Set<string> }
  | { status: 'UNAVAILABLE'; artifactPath: string; error: string }

export interface VisualValidationEvidence {
  screenshot: { status: 'available'; path: string }
  dom: { status: 'available'; content: string }
  console: Array<{ level: 'debug' | 'info' | 'warning' | 'error'; message: string }>
  http: Array<{ url: string; status: number; method: string }>
  redaction: { applied: boolean; fields: string[] }
}

const MAX_DIAGNOSTIC_ENTRIES = 500
const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 16_000

function redact(value: string): { value: string; fields: string[] } {
  const fields = new Set<string>()
  const redacted = value.replace(/(^|[?&\s])((?:token|access_token|api[_-]?key|password|secret|authorization)=)[^&\s]+/gi, (_match, separator: string, key: string) => {
    fields.add(key.slice(0, -1))
    return `${separator}${key}[REDACTED]`
  })
  return { value: redacted.slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH), fields: [...fields] }
}

interface BrowserRuntime {
  launch(options: { headless: true }): Promise<BrowserLike>
}

export class VisualValidationRunner {
  constructor(
    private readonly runtime: BrowserRuntime = chromium,
    private readonly fileExists: (filePath: string) => boolean = (filePath) => fs.existsSync(filePath),
    private readonly statFile: (filePath: string) => { isFile(): boolean } = (filePath) => fs.statSync(filePath),
  ) {}

  async launchArtifact(
    input: unknown,
    workspacePath: string | null | undefined,
  ): Promise<VisualValidationLaunchResult> {
    const parsed = visualValidationRequestSchema.safeParse(input)
    const artifactPath = parsed.success ? parsed.data.artifactPath : String((input as { artifactPath?: unknown })?.artifactPath || '')
    if (!parsed.success) return { status: 'UNAVAILABLE', artifactPath, error: 'Invalid visual validation request.' }

    const pathCheck = validatePathSafety(parsed.data.artifactPath, workspacePath)
    if (!pathCheck.safePath) return { status: 'UNAVAILABLE', artifactPath: parsed.data.artifactPath, error: `Security Violation: ${pathCheck.error}` }
    if (!this.fileExists(pathCheck.safePath)) return { status: 'UNAVAILABLE', artifactPath: parsed.data.artifactPath, error: 'Artifact does not exist.' }
    if (!this.statFile(pathCheck.safePath).isFile()) return { status: 'UNAVAILABLE', artifactPath: parsed.data.artifactPath, error: 'Artifact path is not a regular file.' }

    let browser: BrowserLike | undefined
    try {
      browser = await this.runtime.launch({ headless: true })
      const context = await browser.newContext({ viewport: parsed.data.viewport })
      const page = await context.newPage()
      const consoleEntries: VisualValidationEvidence['console'] = []
      const httpEntries: VisualValidationEvidence['http'] = []
      const redactedFields = new Set<string>()
      page.on?.('console', (payload) => {
        if (consoleEntries.length >= MAX_DIAGNOSTIC_ENTRIES) return
        const consoleMessage = payload as { type?: () => string; text?: () => string }
        const message = redact(consoleMessage.text?.() || String(payload))
        message.fields.forEach((field) => redactedFields.add(field))
        const rawLevel = consoleMessage.type?.() || 'info'
        const level = rawLevel === 'warning' ? 'warning' : rawLevel === 'error' ? 'error' : rawLevel === 'debug' ? 'debug' : 'info'
        consoleEntries.push({ level, message: message.value })
      })
      page.on?.('response', (payload) => {
        if (httpEntries.length >= MAX_DIAGNOSTIC_ENTRIES) return
        const response = payload as { url?: () => string; status?: () => number; request?: () => { method?: () => string } }
        const url = redact(response.url?.() || '').value
        const status = response.status?.() || 0
        if (status < 400) return
        if (redact(response.url?.() || '').fields.length > 0) redactedFields.add('url')
        httpEntries.push({ url, status, method: response.request?.().method?.() || 'GET' })
      })
      await page.goto(pathToFileURL(path.resolve(pathCheck.safePath)).href, { waitUntil: 'load', timeout: parsed.data.timeoutMs })
      let closed = false
      const close = async () => {
        if (closed) return
        closed = true
        await browser?.close()
      }
      return { status: 'ready', artifactPath: pathCheck.safePath, browser, context, page, close, consoleEntries, httpEntries, redactedFields }
    } catch (error: unknown) {
      await browser?.close().catch(() => undefined)
      const message = error instanceof Error ? error.message : String(error)
      return { status: 'UNAVAILABLE', artifactPath: parsed.data.artifactPath, error: `Playwright runtime unavailable: ${message}` }
    }
  }

  async captureEvidence(
    input: unknown,
    workspacePath: string | null | undefined,
    outputDirectory: string,
    signal?: AbortSignal,
  ): Promise<VisualValidationEvidence | { status: 'UNAVAILABLE'; error: string }> {
    const launch = await this.launchArtifact(input, workspacePath)
    if (launch.status !== 'ready') return launch
    const request = visualValidationRequestSchema.parse(input)
    const outputPath = path.join(outputDirectory, 'preview.png')
    if (!validatePathSafety('preview.png', outputDirectory).safePath) {
      await launch.close()
      return { status: 'UNAVAILABLE', error: 'Evidence output path escapes the output directory.' }
    }

    let aborted = false
    const abort = () => {
      aborted = true
      void launch.close()
    }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      if (signal?.aborted) throw new Error('Operation aborted')
      await launch.page.screenshot({ path: outputPath, timeout: request.timeoutMs })
      if (aborted) throw new Error('Operation aborted')
      const content = await launch.page.content()
      return {
        screenshot: { status: 'available', path: outputPath },
        dom: { status: 'available', content },
        console: launch.consoleEntries,
        http: launch.httpEntries,
        redaction: { applied: launch.redactedFields.size > 0, fields: [...launch.redactedFields] },
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return { status: 'UNAVAILABLE', error: `Visual evidence capture failed: ${message}` }
    } finally {
      signal?.removeEventListener('abort', abort)
      await launch.close()
    }
  }
}
