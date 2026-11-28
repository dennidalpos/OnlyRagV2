import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import type { AppSettings } from '../../types'
import { ModelSamplingControl } from './ModelSamplingControl'

const baseSettings: AppSettings = { defaultModel: '', ocrEngine: 'native_cuda', capabilityPolicyMode: 'network-approved', ollamaHost: 'http://localhost:11434' }

describe('ModelSamplingControl', () => {
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

  const renderControl = async (props: Partial<ComponentProps<typeof ModelSamplingControl>> = {}) => {
    const onUpdateSettings = vi.fn()
    await act(async () =>
      root.render(
        <I18nProvider initialLanguage="en">
          <ModelSamplingControl modelName="qwen3.8:27b" settings={baseSettings} onUpdateSettings={onUpdateSettings} {...props} />
        </I18nProvider>,
      ),
    )
    return onUpdateSettings
  }

  const input = (key: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${key} qwen3.8:27b"]`)!

  const type = async (key: string, value: string) => {
    const field = input(key)
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      field.dispatchEvent(new FocusEvent('blur', { bubbles: false }))
      field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
  }

  it('shows Modelfile defaults when nothing is overridden', async () => {
    await renderControl()
    expect(container.textContent).toContain('(Modelfile defaults)')
    expect(input('temperature').value).toBe('')
  })

  it('saves a valid value for this model only, keeping other models', async () => {
    const onUpdateSettings = await renderControl({ settings: { ...baseSettings, modelSamplingOverrides: { 'other:7b': { top_k: 40 } } } })
    await type('temperature', '0,6')

    expect(onUpdateSettings).toHaveBeenCalledWith({ modelSamplingOverrides: { 'other:7b': { top_k: 40 }, 'qwen3.8:27b': { temperature: 0.6 } } })
  })

  it('does not save an out-of-range or non-integer value', async () => {
    const onUpdateSettings = await renderControl()
    await type('temperature', '5')
    await type('top_k', '2.5')

    expect(onUpdateSettings).not.toHaveBeenCalled()
    expect(input('temperature').getAttribute('aria-invalid')).toBe('true')
  })

  it('clears a field back to the Modelfile default and resets all overrides', async () => {
    const settings = { ...baseSettings, modelSamplingOverrides: { 'qwen3.8:27b': { temperature: 0.6, top_k: 20 } } }
    const onUpdateSettings = await renderControl({ settings })
    expect(container.textContent).toContain('(2 overridden)')

    await type('temperature', '')
    expect(onUpdateSettings).toHaveBeenLastCalledWith({ modelSamplingOverrides: { 'qwen3.8:27b': { top_k: 20 } } })

    const reset = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Reset')!
    await act(async () => reset.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onUpdateSettings).toHaveBeenLastCalledWith({ modelSamplingOverrides: {} })
  })
})
