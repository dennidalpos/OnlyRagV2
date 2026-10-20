import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../../i18n'
import { ModelBadgeStrip } from './ModelBadgeStrip'

describe('runtime model badges', () => {
  it.each(['qwen2.5-coder:7b', 'qwen3.5:9b'])('shows only runtime capabilities for %s', async (modelName) => {
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () =>
        root.render(
          <I18nProvider initialLanguage="en">
            <ModelBadgeStrip status="compatible" metrics={{ capabilities: ['tools'], contextLength: 32768 }} />
          </I18nProvider>,
        ),
      )
      expect(container.textContent).toContain('Tool runtime compatible')
      expect(container.textContent).not.toContain('Focused probes')
      expect(container.textContent).not.toContain('unqualified')
      expect(container.textContent).toContain('Max 32k ctx')
    } finally {
      await act(async () => root.unmount())
    }
  })

  it('does not interpret missing capability metadata as a failed tool capability', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () =>
        root.render(
          <I18nProvider initialLanguage="en">
            <ModelBadgeStrip status="unknown" />
          </I18nProvider>,
        ),
      )
      expect(container.textContent).toContain('Runtime unknown')
      expect(container.textContent).not.toContain('probe evidence')
      expect(container.textContent).not.toContain('no tool calling')
    } finally {
      await act(async () => root.unmount())
    }
  })
})
