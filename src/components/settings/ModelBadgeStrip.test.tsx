import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../../i18n'
import { ModelBadgeStrip } from './ModelBadgeStrip'

describe('model qualification badges', () => {
  it.each(['qwen2.5-coder:7b', 'qwen3.5:9b'])('retains probe limits without claiming full-task qualification for %s', async (modelName) => {
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () =>
        root.render(
          <I18nProvider initialLanguage="en">
            <ModelBadgeStrip modelName={modelName} status="compatible" metrics={{ capabilities: ['tools'], contextLength: 32768 }} />
          </I18nProvider>,
        ),
      )
      expect(container.textContent).toContain('Tool runtime compatible')
      expect(container.textContent).toContain('Focused probes passed')
      expect(container.textContent).toContain('Full task unqualified')
      expect(container.textContent).toContain('Max 32k ctx')
      const tooltips = [...container.querySelectorAll('[title]')].map((el) => el.getAttribute('title')).join('\n')
      expect(tooltips).toContain(modelName.includes('9b') ? 'zero complete sequences' : 'does not finish the plan')
      expect(tooltips).toContain('recorded configuration only')
      expect(tooltips).not.toContain('fenced JSON')
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
            <ModelBadgeStrip modelName="custom:7b" status="unknown" />
          </I18nProvider>,
        ),
      )
      expect(container.textContent).toContain('Runtime unknown')
      expect(container.textContent).toContain('No probe evidence')
      expect(container.textContent).not.toContain('no tool calling')
    } finally {
      await act(async () => root.unmount())
    }
  })
})
