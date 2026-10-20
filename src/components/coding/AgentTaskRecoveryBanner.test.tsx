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
      <AgentTaskRecoveryBanner tasks={[task]} error={error} busy={busy} onResume={resume} />
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
