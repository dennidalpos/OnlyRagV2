import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { AgentTaskRecoveryBanner } from './AgentTaskRecoveryBanner'
import type { AgentTaskRecovery } from '../../types'

it('shows retained permissions without resuming until an explicit click; busy storage prevents dispatch', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  const resume = vi.fn(async () => {})
  const task: AgentTaskRecovery = {
    identity: { runId: 'interrupted', conversationId: 'conversation', planRevisionId: 'plan', workspaceId: 'workspace' },
    userTask: 'Continue the retained work',
    workspacePath: 'C:/workspace',
    agentMode: 'auto',
    acceptedAt: new Date().toISOString(),
    capabilityProfile: { allowFileModifications: true, allowTerminalExecution: false, capabilityPolicyMode: 'offline-strict', maxToolCallSteps: 10 },
  }
  const render = (busy: boolean, error = '') => (
    <I18nProvider initialLanguage="en">
      <AgentTaskRecoveryBanner tasks={[task]} error={error} busy={busy} onResume={resume} onInspect={vi.fn()} onAbandon={vi.fn()} />
    </I18nProvider>
  )
  try {
    await act(async () => root.render(render(false)))
    expect(container.textContent).toContain('Continue the retained work')
    expect(container.textContent).toContain('Terminal: false')
    expect(resume).not.toHaveBeenCalled()
    await act(async () => container.querySelector('button')!.click())
    expect(resume).toHaveBeenCalledExactlyOnceWith(task)
    await act(async () => root.render(render(true, 'Disk unavailable')))
    expect(container.querySelector('button')!.disabled).toBe(true)
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Disk unavailable')
  } finally {
    await act(async () => root.unmount())
  }
})

it('renders evidence as text and requires inspection and consent before abandonment; failed writes remain visible', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  const task: AgentTaskRecovery = {
    identity: { runId: 'unknown', conversationId: 'conversation', planRevisionId: 'plan', workspaceId: 'workspace' },
    userTask: 'Interrupted command',
    workspacePath: 'C:/workspace',
    agentMode: 'auto',
    acceptedAt: new Date().toISOString(),
    capabilityProfile: { allowFileModifications: true, allowTerminalExecution: true, capabilityPolicyMode: 'offline-strict', maxToolCallSteps: 10 },
  }
  const resume = vi.fn(async () => {})
  const inspect = vi.fn(async () => ({
    identity: task.identity,
    evidence: '<img src=x onerror="alert(1)"> retained intent',
    evidenceDigest: 'a'.repeat(64),
    canAbandon: true,
  }))
  const abandon = vi.fn(async () => {
    throw new Error('Archive disk failure')
  })
  const button = (label: string) => [...container.querySelectorAll('button')].find((element) => element.textContent === label)!
  try {
    await act(async () =>
      root.render(
        <I18nProvider initialLanguage="en">
          <AgentTaskRecoveryBanner tasks={[task]} error="" busy={false} onResume={resume} onInspect={inspect} onAbandon={abandon} />
        </I18nProvider>,
      ),
    )
    expect(button('Abandon run')).toBeUndefined()
    await act(async () => button('Inspect evidence').click())
    expect(inspect).toHaveBeenCalledExactlyOnceWith(task)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('pre')?.textContent).toContain('<img')
    expect(button('Abandon run').disabled).toBe(true)
    await act(async () => container.querySelector<HTMLInputElement>('input')!.click())
    await act(async () => button('Abandon run').click())
    expect(abandon).toHaveBeenCalledExactlyOnceWith(task, 'a'.repeat(64))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Archive disk failure')
    expect(container.querySelector('pre')).not.toBeNull()
    expect(resume).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
  }
})
