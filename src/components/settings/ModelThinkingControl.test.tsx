import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { ModelThinkingControl } from './ModelThinkingControl'

describe('ModelThinkingControl', () => {
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

  const renderControl = async (props: Partial<ComponentProps<typeof ModelThinkingControl>> = {}) => {
    const onUpdateSettings = vi.fn()
    await act(async () =>
      root.render(
        <I18nProvider initialLanguage="it">
          <ModelThinkingControl
            modelName="qwen3:4b"
            metrics={{ 'qwen3:4b': { capabilities: ['completion', 'thinking'], family: 'qwen3' } }}
            settings={{ defaultModel: '', ocrEngine: 'native_cuda', ollamaHost: 'http://localhost:11434' }}
            onUpdateSettings={onUpdateSettings}
            {...props}
          />
        </I18nProvider>,
      ),
    )
    return onUpdateSettings
  }

  it('shows the disabled default and persists an independent enabled preference', async () => {
    const onUpdateSettings = await renderControl()
    expect(container.textContent).toContain('Disattivato per impostazione predefinita')
    await act(async () => (container.querySelector('[role="switch"]') as HTMLButtonElement).click())
    expect(onUpdateSettings).toHaveBeenCalledWith({ modelThinkingPreferences: { 'qwen3:4b': true } })
  })

  it('offers only levels, without an off switch, for level-only models', async () => {
    await renderControl({
      modelName: 'gpt-oss:20b',
      metrics: { 'gpt-oss:20b': { capabilities: ['completion', 'thinking'], family: 'gpt-oss' } },
    })
    const labels = Array.from(container.querySelectorAll('[role="radio"]')).map((button) => button.textContent)
    expect(labels).toEqual(['Predefinito del modello', 'low', 'medium', 'high'])
    expect(container.querySelector('[role="switch"]')).toBeNull()
  })

  it('lists the levels /api/show reports and stores or clears the chosen one', async () => {
    const metrics = {
      'qwen3.8:27b': { capabilities: ['completion', 'tools', 'thinking'], thinking: { values: [false, 'low', 'medium', 'xhigh'], default: 'medium' } },
    }
    const onUpdateSettings = await renderControl({ modelName: 'qwen3.8:27b', metrics })
    const buttons = Array.from(container.querySelectorAll('[role="radio"]')) as HTMLButtonElement[]
    expect(buttons.map((button) => button.textContent)).toEqual(['Predefinito del modello (medium)', 'Spento', 'low', 'medium', 'xhigh'])
    expect(buttons[0].getAttribute('aria-checked')).toBe('true')
    await act(async () => buttons[2].click())
    expect(onUpdateSettings).toHaveBeenCalledWith({ modelThinkingPreferences: { 'qwen3.8:27b': 'low' } })
  })

  it('renders no control for unsupported models', async () => {
    await renderControl({
      modelName: 'llama3.2:3b',
      metrics: { 'llama3.2:3b': { capabilities: ['completion'], family: 'llama' } },
    })
    expect(container.innerHTML).toBe('')
  })
})
