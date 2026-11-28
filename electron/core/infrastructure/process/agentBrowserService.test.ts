import { describe, expect, it, vi } from 'vitest'
import { AgentBrowserService } from './agentBrowserService'
import { managedDevServerRepository } from './managedDevServerRepository'

describe('AgentBrowserService lifecycle', () => {
  it('closes Chromium when a navigation times out', async () => {
    const page = {
      on: vi.fn(),
      goto: vi.fn().mockRejectedValue(new Error('Timeout exceeded')),
      isClosed: vi.fn(() => false),
      mainFrame: vi.fn(),
    }
    const context = { route: vi.fn(), routeWebSocket: vi.fn(), newPage: vi.fn(async () => page), on: vi.fn() }
    const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => undefined) }
    const port = vi.spyOn(managedDevServerRepository, 'runningPort').mockReturnValue(49231)
    try {
      const service = new AgentBrowserService(async () => browser as never)
      const result = await service.navigate('run-timeout', 'workspace', '/')
      expect(result.outcome).toBe('failure')
      expect(result.outputForHistory).toContain('Timeout exceeded')
      expect(browser.close).toHaveBeenCalledOnce()
      expect((await service.snapshot('run-timeout')).outcome).toBe('failure')
    } finally {
      port.mockRestore()
    }
  })

  it('waits for an in-flight close before reporting all browser runs closed', async () => {
    let finishClose: () => void = () => undefined
    const closePromise = new Promise<void>((resolve) => {
      finishClose = resolve
    })
    const page = {
      on: vi.fn(),
      goto: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => ({ text: '', controls: [] })),
      title: vi.fn(async () => 'Ready'),
      url: vi.fn(() => 'http://127.0.0.1:49231/'),
      isClosed: vi.fn(() => false),
      mainFrame: vi.fn(),
    }
    const context = { route: vi.fn(), routeWebSocket: vi.fn(), newPage: vi.fn(async () => page), on: vi.fn() }
    const browser = { newContext: vi.fn(async () => context), close: vi.fn(() => closePromise) }
    const port = vi.spyOn(managedDevServerRepository, 'runningPort').mockReturnValue(49231)
    try {
      const service = new AgentBrowserService(async () => browser as never)
      expect((await service.navigate('run-close', 'workspace', '/')).outcome).toBe('success')
      const first = service.closeRun('run-close')
      const all = service.closeAll()
      let allClosed = false
      void all.then(() => {
        allClosed = true
      })
      await Promise.resolve()
      expect(allClosed).toBe(false)
      finishClose()
      await Promise.all([first, all])
      expect(allClosed).toBe(true)
      expect(browser.close).toHaveBeenCalledOnce()
    } finally {
      port.mockRestore()
    }
  })
})
