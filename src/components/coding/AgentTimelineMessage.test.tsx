import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import type { AgentActionLog } from '../../types'
import { AgentTimelineMessage } from './AgentTimelineMessage'

describe('AgentTimelineMessage browser evidence', () => {
  it('loads a run-owned screenshot through the narrow IPC and displays it inline', async () => {
    const artifact = { workspacePath: 'C:/workspace', runId: 'run-1', screenshotId: '12345678-1234-1234-1234-123456789abc' }
    const read = vi.fn().mockResolvedValue({ success: true, imageBase64: 'iVBORw0KGgo=' })
    const originalApi = window.electronAPI
    window.electronAPI = { readAgentBrowserScreenshot: read } as never
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const log: AgentActionLog = {
      id: 'log-1',
      timestamp: new Date().toISOString(),
      type: 'info',
      message: 'Browser screenshot captured.',
      category: 'browser_activity',
      browserScreenshot: artifact,
    }
    try {
      await act(async () => {
        root.render(
          <I18nProvider initialLanguage="it">
            <AgentTimelineMessage log={log} isExpanded={false} onToggleExpand={vi.fn()} />
          </I18nProvider>,
        )
      })
      expect(read).toHaveBeenCalledWith(artifact)
      expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=')
    } finally {
      await act(async () => root.unmount())
      container.remove()
      window.electronAPI = originalApi
    }
  })
})
