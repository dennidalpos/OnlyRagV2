import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { stripVTControlCharacters } from 'node:util'
import { chromium, type Page } from 'playwright'
import { expect } from 'vitest'
import type { TaskLabFeature } from './taskLabPrompts'
import { managedDevServerRepository } from '../../electron/core/infrastructure/process/managedDevServerRepository'

export const TASKLAB_WIDTHS = [320, 375, 768, 1024, 1440, 1920] as const

export async function checkTaskLabCommand(workspace: string, outputRoot: string, script: 'build' | 'test') {
  const args = ['run', script, ...(script === 'test' ? ['--', '--run'] : [])]
  await new Promise<void>((resolve, reject) => {
    const executable = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npm'
    const argv = process.platform === 'win32' ? ['/d', '/s', '/c', `npm ${args.join(' ')}`] : args
    execFile(executable, argv, { cwd: workspace, windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      fs.writeFileSync(path.join(outputRoot, `${script}.log`), `${stdout}\n${stderr}`, 'utf8')
      const missingTests = script === 'test' && !/Tests\s+\d+\s+passed/.test(stripVTControlCharacters(stdout))
      fs.writeFileSync(
        path.join(outputRoot, `${script}.json`),
        JSON.stringify({
          command: `npm ${args.join(' ')}`,
          passed: !error && !missingTests,
          error: error?.message || (missingTests ? 'No passed Vitest tests' : undefined),
        }),
        'utf8',
      )
      if (error) return reject(error)
      if (missingTests) {
        return reject(new Error('TaskLab must execute behavioral Vitest tests; an empty or placeholder test script is not evidence.'))
      }
      resolve()
    })
  })
}

async function tasks(page: Page) {
  const menu = page.getByRole('button', { name: 'Menu', exact: true })
  const tasksLink = page.getByRole('navigation').getByText('Tasks', { exact: true }).first()
  if (!(await tasksLink.isVisible()) && (await menu.isVisible())) await menu.click()
  await tasksLink.click()
  await expect.poll(() => page.getByRole('main').textContent()).toContain('Tasks')
}

async function add(page: Page, title: string, description: string) {
  const form = page.getByRole('form', { name: 'New task', exact: true })
  await form.getByLabel('Title', { exact: true }).fill(title)
  await form.getByLabel('Description', { exact: true }).fill(description)
  await form.getByRole('button', { name: 'Add task', exact: true }).click()
  await expect.poll(() => page.getByRole('article', { name: `Task: ${title}`, exact: true }).textContent()).toContain(description)
}

/** Independent browser assertions; never edits model-authored source or installs dependencies. */
export async function verifyTaskLab(workspace: string, outputRoot: string, features: ReadonlySet<TaskLabFeature>) {
  const existingPort = managedDevServerRepository.runningPort(workspace)
  const started = !existingPort
  const port = existingPort || (await managedDevServerRepository.start(workspace)).port
  // A server already owned by the agent is deliberately reused until the stage is archived.
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const failures: string[] = []
  const checks: Array<{ width: number; view: string; state: unknown }> = []
  let passed = false
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
    const page = await context.newPage()
    page.on('pageerror', (error) => failures.push(error.message))
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url())
      if (url.origin === `http://127.0.0.1:${port}` || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
      failures.push(`Unexpected external connection: ${url.origin}`)
      return route.abort()
    })
    const response = await page.goto(`http://127.0.0.1:${port}/`)
    expect(response?.ok()).toBe(true)
    await expect.poll(() => page.getByRole('main').getByRole('heading', { name: 'TaskLab', exact: true }).isVisible()).toBe(true)
    const headingStyle = await page.getByRole('heading', { name: 'TaskLab', exact: true }).evaluate((element) => {
      const style = getComputedStyle(element)
      return { fontSize: Number.parseFloat(style.fontSize), fontWeight: Number.parseFloat(style.fontWeight) }
    })
    if (features.has('styles')) {
      expect(headingStyle.fontSize, 'Compiled Tailwind heading size').toBeGreaterThanOrEqual(24)
      expect(headingStyle.fontWeight, 'Compiled Tailwind heading weight').toBeGreaterThanOrEqual(700)
      if (!features.has('navigation')) expect(headingStyle.fontSize).toBe(24)
    }
    if (features.has('navigation')) {
      await tasks(page)
      const taskView = await page.getByRole('main').innerText()
      await page.getByRole('navigation').getByText('Dashboard', { exact: true }).first().click()
      expect(await page.getByRole('main').innerText()).not.toBe(taskView)
      await tasks(page)
    }
    if (features.has('create')) {
      const count = await page.getByRole('article').count()
      await page.getByRole('form', { name: 'New task', exact: true }).getByRole('button', { name: 'Add task', exact: true }).click()
      expect(await page.getByRole('article').count(), 'Empty title must not create a task').toBe(count)
      await add(page, 'Révision, "priority"', 'First, record\nsecond line')
      await add(page, 'Second task', 'Keep creation order')
      const complete = page.getByRole('checkbox', { name: 'Complete Second task', exact: true })
      await complete.check()
      await expect.poll(() => complete.isChecked()).toBe(true)
      if (features.has('persistence')) {
        await page.reload()
        await tasks(page)
        await expect.poll(() => complete.isChecked()).toBe(true)
        await expect.poll(() => page.getByRole('article', { name: 'Task: Révision, "priority"', exact: true }).textContent()).toContain('First, record')
      }
      if (features.has('crud')) {
        await page.getByRole('button', { name: 'Edit Second task', exact: true }).click()
        const edit = page.getByRole('form', { name: 'Edit task', exact: true })
        await edit.getByLabel('Title', { exact: true }).fill('Cancelled change')
        await edit.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect.poll(() => page.getByRole('article', { name: 'Task: Second task', exact: true }).isVisible()).toBe(true)
        await page.getByRole('button', { name: 'Edit Second task', exact: true }).click()
        await edit.getByLabel('Title', { exact: true }).fill('Updated task')
        await edit.getByLabel('Description', { exact: true }).fill('Saved description')
        await edit.getByRole('button', { name: 'Save', exact: true }).click()
        await expect.poll(() => page.getByRole('article', { name: 'Task: Updated task', exact: true }).textContent()).toContain('Saved description')
      }
      if (features.has('filter')) {
        const filter = page.getByLabel('Status filter', { exact: true })
        await filter.selectOption({ label: 'Active' })
        await expect
          .poll(() => page.getByRole('article', { name: `Task: ${features.has('crud') ? 'Updated task' : 'Second task'}`, exact: true }).isVisible())
          .toBe(false)
        await filter.selectOption({ label: 'Completed' })
        await expect.poll(() => page.getByRole('article', { name: 'Task: Révision, "priority"', exact: true }).isVisible()).toBe(false)
        await filter.selectOption({ label: 'All' })
      }
      if (features.has('csv')) {
        const download = page.waitForEvent('download')
        await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
        const file = await download
        const output = path.join(outputRoot, 'export.csv')
        await file.saveAs(output)
        const csv = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(output))
        expect(csv).toContain('"Révision, ""priority"""')
        expect(csv).toContain('"First, record\nsecond line"')
        expect(csv).toContain('\r\n')
        expect(csv.indexOf('Révision')).toBeLessThan(csv.indexOf('Updated task'))
        await page.getByLabel('Status filter', { exact: true }).selectOption({ label: 'Active' })
        const filteredDownload = page.waitForEvent('download')
        await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
        const filteredPath = path.join(outputRoot, 'export-active.csv')
        await (await filteredDownload).saveAs(filteredPath)
        expect(fs.readFileSync(filteredPath, 'utf8')).not.toContain('Updated task')
        await page.getByLabel('Status filter', { exact: true }).selectOption({ label: 'All' })
      }
      if (features.has('crud')) {
        await page.getByRole('button', { name: 'Delete Updated task', exact: true }).click()
        await expect.poll(() => page.getByRole('article', { name: 'Task: Updated task', exact: true }).count()).toBe(0)
        await expect.poll(() => page.getByRole('article', { name: 'Task: Révision, "priority"', exact: true }).isVisible()).toBe(true)
        if (features.has('persistence')) {
          await page.reload()
          await tasks(page)
          await expect.poll(() => page.getByRole('article', { name: 'Task: Updated task', exact: true }).count()).toBe(0)
        }
      }
    }
    for (const width of TASKLAB_WIDTHS) {
      await page.setViewportSize({ width, height: 1000 })
      if (features.has('mobile') && width < 768) {
        const menu = page.getByRole('button', { name: 'Menu', exact: true })
        expect(await menu.isVisible()).toBe(true)
        await menu.click()
        expect(await menu.getAttribute('aria-expanded')).toBe('true')
        await tasks(page)
        expect(await menu.getAttribute('aria-expanded')).toBe('false')
      }
      if (features.has('tablet') && width === 768) {
        const toggle = page.getByRole('button', { name: 'Toggle sidebar', exact: true })
        const before = await toggle.getAttribute('aria-expanded')
        await toggle.click()
        expect(await toggle.getAttribute('aria-expanded')).not.toBe(before)
        await toggle.click()
        expect(await toggle.getAttribute('aria-expanded')).toBe(before)
      }
      for (const view of features.has('navigation') ? ['Dashboard', 'Tasks'] : ['TaskLab']) {
        if (view === 'Tasks') await tasks(page)
        if (view === 'Dashboard') {
          const link = page.getByRole('navigation').getByText('Dashboard', { exact: true }).first()
          if (!(await link.isVisible())) await page.getByRole('button', { name: 'Menu', exact: true }).click()
          await link.click()
          if (features.has('mobile') && width < 768) {
            const cards = page.getByRole('region', { name: 'Dashboard cards', exact: true }).getByRole('article')
            expect(await cards.count()).toBeGreaterThanOrEqual(2)
            const first = await cards.nth(0).boundingBox()
            const second = await cards.nth(1).boundingBox()
            expect(first).not.toBeNull()
            expect(second).not.toBeNull()
            expect(second!.y, `Single-column Dashboard at ${width}px`).toBeGreaterThanOrEqual(first!.y + first!.height - 1)
          }
          if ((features.has('tablet') && width === 768) || (features.has('desktop') && width >= 1024)) {
            const columns = await page.getByRole('region', { name: 'Dashboard cards', exact: true }).evaluate((element) => {
              const style = getComputedStyle(element)
              return style.display === 'grid' ? style.gridTemplateColumns.split(' ').length : 0
            })
            expect(columns, `Dashboard columns at ${width}px`).toBeGreaterThanOrEqual(2)
          }
          if (features.has('desktop') && width >= 1024) {
            const sidebar = await page.getByRole('complementary', { name: 'Sidebar', exact: true }).boundingBox()
            const main = await page.getByRole('main').boundingBox()
            expect(sidebar).not.toBeNull()
            expect(sidebar!.x + sidebar!.width).toBeLessThanOrEqual(main!.x + 1)
          }
        }
        if (view === 'Tasks' && features.has('create')) {
          const form = page.getByRole('form', { name: 'New task', exact: true })
          const title = await form.getByLabel('Title', { exact: true }).boundingBox()
          const description = await form.getByLabel('Description', { exact: true }).boundingBox()
          const formBox = await form.boundingBox()
          expect(title).not.toBeNull()
          expect(description).not.toBeNull()
          if (width < 768) {
            expect(title!.y).toBeLessThan(description!.y)
            expect(title!.width).toBeGreaterThanOrEqual(formBox!.width * 0.85)
            expect(description!.width).toBeGreaterThanOrEqual(formBox!.width * 0.85)
          } else if (width >= 1024) {
            expect(Math.abs(title!.y - description!.y), `Desktop form columns at ${width}px`).toBeLessThanOrEqual(4)
            expect(description!.x).toBeGreaterThan(title!.x + title!.width - 1)
          }
        }
        const state = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          smallTargets: [...document.querySelectorAll('button, nav a')]
            .map((element) => ({ text: element.textContent, rect: element.getBoundingClientRect() }))
            .filter(({ rect }) => rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44))
            .map(({ text }) => text),
          clipped: [...document.querySelectorAll('main input, main textarea')].some((element) => {
            const rect = element.getBoundingClientRect()
            return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1)
          }),
          typography: [...document.querySelectorAll('main h1, main h2, main p, main label')]
            .filter((element) => element.getBoundingClientRect().width > 0)
            .map((element) => {
              const style = getComputedStyle(element)
              return { text: element.textContent, fontSize: style.fontSize, lineHeight: style.lineHeight }
            }),
          spacing: [...document.querySelectorAll('main, main form, main section, main article')]
            .filter((element) => element.getBoundingClientRect().width > 0)
            .map((element) => {
              const style = getComputedStyle(element)
              return { tag: element.tagName, padding: style.padding, margin: style.margin, gap: style.gap }
            }),
        }))
        checks.push({ width, view, state })
        expect(state.overflow, `${view} overflows at ${width}px`).toBe(false)
        expect(state.clipped, `${view} form clipped at ${width}px`).toBe(false)
        if (features.has('mobile')) expect(state.smallTargets, `${view} touch targets at ${width}px`).toEqual([])
        await page.screenshot({ path: path.join(outputRoot, `${view.toLowerCase()}-${width}.png`), fullPage: true })
      }
    }
    if (features.has('refactor')) {
      expect(fs.existsSync(path.join(workspace, 'src/components/TaskCard.jsx'))).toBe(false)
      expect(fs.existsSync(path.join(workspace, 'src/components/TaskItem.jsx'))).toBe(true)
    }
    if (features.has('boundaries')) {
      expect(fs.existsSync(path.join(workspace, 'src/services/taskStore.js'))).toBe(true)
      const boundaries = fs.readFileSync(path.join(workspace, 'src/services/README.md'), 'utf8')
      for (const name of ['MongoDB', 'Redis', 'TodoWrite', 'Nuvolaris']) expect(boundaries).toContain(name)
    }
    if (features.has('resumed')) await expect.poll(() => page.getByRole('main').textContent()).toContain('TaskLab ready')
    expect(failures, 'Browser runtime or external connection failures').toEqual([])
    await context.close()
    passed = true
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    fs.writeFileSync(path.join(outputRoot, 'browser.json'), JSON.stringify({ passed, widths: TASKLAB_WIDTHS, checks, failures }, null, 2), 'utf8')
    await browser.close()
    if (started && managedDevServerRepository.runningPort(workspace)) managedDevServerRepository.stop(workspace)
  }
}
