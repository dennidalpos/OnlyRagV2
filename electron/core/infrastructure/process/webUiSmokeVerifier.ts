import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { redactSecrets } from '../../../logRedactor'
import type { PlanMilestone } from '../../../../shared/domain/agent/planAndSolveGraph'
import { managedDevServerRepository } from './managedDevServerRepository'

const WIDTHS = [320, 375, 768, 1024, 1440, 1920] as const

export interface WebUiSmokeResult {
  status: 'passed' | 'failed' | 'not_applicable' | 'unavailable'
  detail?: string
}

function requirements(milestones: readonly PlanMilestone[]) {
  const text = milestones.flatMap((milestone) => [milestone.title, ...(milestone.acceptanceCriteria ?? [])]).join(' ')
  return {
    tailwind: /\btailwind\b/i.test(text),
    touchTargets: /\btouch targets?\b|44\s*[×x]\s*44/i.test(text),
    tasksNavigation: /\bDashboard\b/i.test(text) && /\bTasks\b/i.test(text) && /\b(?:navigation|routing|sidebar)\b/i.test(text),
  }
}

function hasBuiltCss(workspacePath: string): boolean {
  const dist = path.join(workspacePath, 'dist')
  if (!fs.existsSync(dist)) return false
  const pending = [dist]
  while (pending.length > 0) {
    const directory = pending.pop()!
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) pending.push(path.join(directory, entry.name))
      else if (entry.isFile() && entry.name.endsWith('.css') && fs.statSync(path.join(directory, entry.name)).size > 0) return true
    }
  }
  return false
}

/** Exercises a locally managed web app after compilation, including browser runtime errors. */
export async function verifyWebUi(workspacePath: string, milestones: readonly PlanMilestone[] = [], signal?: AbortSignal): Promise<WebUiSmokeResult> {
  if (!fs.existsSync(path.join(workspacePath, 'index.html')) || !fs.existsSync(path.join(workspacePath, 'package.json'))) {
    return { status: 'not_applicable' }
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(workspacePath, 'package.json'), 'utf-8')) as { scripts?: { dev?: unknown } }
  if (typeof manifest.scripts?.dev !== 'string' || !manifest.scripts.dev.trim()) return { status: 'not_applicable' }
  if (signal?.aborted) return { status: 'unavailable', detail: 'Browser verification was cancelled.' }

  const need = requirements(milestones)
  const errors: string[] = []
  if (need.tailwind && !hasBuiltCss(workspacePath)) errors.push('Tailwind styling requested, but the build emitted no CSS file.')

  let started = false
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    let port = managedDevServerRepository.runningPort(workspacePath)
    if (!port) {
      port = (await managedDevServerRepository.start(workspacePath)).port
      started = true
    }
    try {
      browser = await chromium.launch({ headless: true, channel: 'chrome' })
    } catch {
      browser = await chromium.launch({ headless: true })
    }
    const context = await browser.newContext({ viewport: { width: WIDTHS[0], height: 900 } })
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(`JavaScript: ${error.message.slice(0, 300)}`))
    const response = await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: 15_000 })
    await page.waitForTimeout(250)
    if (!response?.ok()) errors.push(`Home page returned HTTP ${response?.status() ?? 'no response'}.`)
    for (const width of WIDTHS) {
      if (signal?.aborted) return { status: 'unavailable', detail: 'Browser verification was cancelled.' }
      await page.setViewportSize({ width, height: 900 })
      const state = await page.evaluate(() => {
        const root = document.querySelector('#root, #app') ?? document.body
        const rects = [...document.querySelectorAll('button, a, [role="button"]')]
          .map((element) => ({ text: element.textContent?.trim().slice(0, 50), rect: element.getBoundingClientRect() }))
          .filter(({ rect }) => rect.width > 0 && rect.height > 0)
        return {
          hasContent: Boolean(root.textContent?.trim() || root.querySelector('canvas, img, svg, video')),
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          smallTargets: rects
            .filter(({ rect }) => rect.width < 44 || rect.height < 44)
            .slice(0, 3)
            .map(({ text }) => text || '(unnamed)'),
        }
      })
      if (!state.hasContent) errors.push(`Page rendered no content at ${width}px.`)
      if (state.overflow) errors.push(`Horizontal overflow at ${width}px.`)
      if (need.touchTargets && state.smallTargets.length > 0) errors.push(`Touch targets below 44×44 at ${width}px: ${state.smallTargets.join(', ')}.`)
    }
    if (need.tasksNavigation && errors.length === 0) {
      const before = await page
        .locator('main')
        .first()
        .textContent()
        .catch(() => null)
      const tasks = page
        .getByRole('navigation')
        .getByText(/^Tasks$/i)
        .first()
      if ((await tasks.count()) === 0) errors.push('Tasks navigation is missing.')
      else {
        await tasks.click()
        const after = await page
          .locator('main')
          .first()
          .textContent()
          .catch(() => null)
        if (!after || after === before) errors.push('Tasks navigation did not change the main view.')
      }
    }
    await context.close()
    return errors.length > 0 ? { status: 'failed', detail: redactSecrets([...new Set(errors)].slice(0, 10).join(' ')) } : { status: 'passed' }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { status: 'unavailable', detail: redactSecrets(`Browser verification could not run: ${detail.slice(0, 500)}`) }
  } finally {
    await browser?.close()
    if (started && managedDevServerRepository.runningPort(workspacePath)) managedDevServerRepository.stop(workspacePath)
  }
}
