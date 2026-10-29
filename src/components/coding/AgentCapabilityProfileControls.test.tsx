import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentCapabilityProfileControls } from './AgentCapabilityProfileControls'
import { resolveAgentCapabilityProfile } from '../../../shared/domain/agent/agentCapabilityProfile'

describe('AgentCapabilityProfileControls', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('keeps Full access off by default and shows its restore limit when enabled', async () => {
    const onChange = vi.fn()
    const profile = resolveAgentCapabilityProfile()
    await act(async () => root.render(<AgentCapabilityProfileControls profile={profile} onChange={onChange} />))
    const fullAccess = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(fullAccess.checked).toBe(false)
    await act(async () => {
      fullAccess.click()
    })
    expect(onChange).toHaveBeenCalledWith({ ...profile, fullAccess: true })
    await act(async () => root.render(<AgentCapabilityProfileControls profile={{ ...profile, fullAccess: true }} onChange={onChange} />))
    expect(container.textContent).toContain('checkpoint')
    expect((container.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement).disabled).toBe(true)
  })
})
