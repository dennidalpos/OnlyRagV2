import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../../types'
import { I18nProvider } from '../../i18n'
import { CodingAgentDebugToggle } from './CodingAgentDebugToggle'

const settings: AppSettings = {
  defaultModel: '',
  ocrEngine: 'native_cuda',
  ollamaHost: 'http://127.0.0.1:11434',
  enableCodingAgentDebugLog: false,
  includeCodingAgentDebugPayloads: true,
}

describe('CodingAgentDebugToggle', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('hides the saved payload preference while logging is off and restores it when enabled', async () => {
    const onUpdateSettings = vi.fn()
    const renderControls = async (current: AppSettings) =>
      act(async () =>
        root.render(
          <I18nProvider initialLanguage="it">
            <CodingAgentDebugToggle settings={current} onUpdateSettings={onUpdateSettings} />
          </I18nProvider>,
        ),
      )

    await renderControls(settings)
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(1)
    await act(async () => (container.querySelector('[role="switch"]') as HTMLButtonElement).click())
    expect(onUpdateSettings).toHaveBeenCalledWith({ enableCodingAgentDebugLog: true })

    await renderControls({ ...settings, enableCodingAgentDebugLog: true })
    const switches = container.querySelectorAll('[role="switch"]')
    expect(switches).toHaveLength(2)
    expect(switches[1].getAttribute('aria-checked')).toBe('true')
    expect(container.textContent).toContain('Solo log audit Coding Agent e bundle diagnostici')
    await act(async () => (switches[1] as HTMLButtonElement).click())
    expect(onUpdateSettings).toHaveBeenCalledWith({ includeCodingAgentDebugPayloads: false })
  })
})
