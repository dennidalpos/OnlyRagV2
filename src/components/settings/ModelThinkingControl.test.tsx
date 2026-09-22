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

  it('shows a compatibility note instead of a switch for level-only models', async () => {
    await renderControl({
      modelName: 'gpt-oss:20b',
      metrics: { 'gpt-oss:20b': { capabilities: ['completion', 'thinking'], family: 'gpt-oss' } },
    })
    expect(container.textContent).toContain('Thinking gestito a livelli')
    expect(container.querySelector('[role="switch"]')).toBeNull()
  })

  it('renders no control for unsupported models', async () => {
    await renderControl({
      modelName: 'llama3.2:3b',
      metrics: { 'llama3.2:3b': { capabilities: ['completion'], family: 'llama' } },
    })
    expect(container.innerHTML).toBe('')
  })
})
