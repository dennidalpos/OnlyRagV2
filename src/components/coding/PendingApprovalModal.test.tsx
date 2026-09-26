import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentApprovalRequest } from '../../types'
import { I18nProvider } from '../../i18n'
import { PendingApprovalModal } from './PendingApprovalModal'

const request: AgentApprovalRequest = {
  runId: 'run-1',
  conversationId: 'conversation-1',
  planRevisionId: 'plan-1:v1',
  workspaceId: 'workspace-1',
  sessionId: 'conversation-1',
  type: 'download_file',
  target: 'https://example.test/data.txt',
  contentOrCmd: 'https://example.test/data.txt',
}

describe('PendingApprovalModal reasons', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  const render = (pendingApproval: AgentApprovalRequest, language: 'it' | 'en') =>
    act(async () => {
      root.render(
        <I18nProvider initialLanguage={language}>
          <PendingApprovalModal pendingApproval={pendingApproval} onApprove={vi.fn()} onReject={vi.fn()} />
        </I18nProvider>,
      )
    })

  it.each([
    ['it', 'Richiede: accesso di rete, revisione Guided'],
    ['en', 'Requires: network access, Guided review'],
  ] as const)('names every reason the single review covers (%s)', async (language, expected) => {
    await render({ ...request, reasons: ['network_access', 'guided_review'] }, language)
    expect(document.querySelector('[data-testid="approval-reasons"]')?.textContent).toBe(expected)
  })

  it('shows no reason line for a request without reasons', async () => {
    await render(request, 'en')
    expect(document.querySelector('[data-testid="approval-reasons"]')).toBeNull()
  })
})
