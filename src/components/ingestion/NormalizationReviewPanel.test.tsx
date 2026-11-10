// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { NormalizationReviewPanel } from './NormalizationReviewPanel'

describe('normalization review panel', () => {
  it.each(['it', 'en'] as const)('explains context refusals without losing the complete original (%s)', async (language) => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const original = 'Complete original content, without truncation.'
    try {
      await act(async () =>
        root.render(
          <I18nProvider initialLanguage={language}>
            <NormalizationReviewPanel
              review={{
                originalMarkdown: original,
                issues: [
                  { page: 1, reason: 'context_missing' },
                  { page: 2, reason: 'context_budget_exceeded' },
                ],
              }}
              exporting={false}
              onExport={vi.fn()}
              onDismiss={vi.fn()}
            />
          </I18nProvider>,
        ),
      )
      expect(container.textContent).toContain(language === 'it' ? 'contesto di ingestion mancante' : 'ingestion context missing')
      expect(container.textContent).toContain(language === 'it' ? 'originale conservato' : 'original preserved')
      expect(container.querySelector('textarea')?.value).toBe(original)
    } finally {
      await act(async () => root.unmount())
    }
  })
  it('shows readable reasons and the original as inert text, and exposes export and dismissal', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const onExport = vi.fn()
    const onDismiss = vi.fn()
    const original = '# Original\n\n<script>untrusted content</script> AB123'
    try {
      await act(async () => {
        root.render(
          <I18nProvider initialLanguage="it">
            <NormalizationReviewPanel
              review={{ originalMarkdown: original, issues: [{ page: 2, reason: 'truncated' }] }}
              exporting={false}
              onExport={onExport}
              onDismiss={onDismiss}
            />
          </I18nProvider>,
        )
      })
      expect(container.textContent).toContain('revisione richiesta')
      expect(container.textContent).toContain('Pagina 2: risposta troncata')
      expect(container.textContent).toContain('non salvata e non indicizzata')
      const textarea = container.querySelector('textarea')!
      expect(textarea.value).toBe(original)
      expect(textarea.readOnly).toBe(true)
      expect(container.querySelector('script')).toBeNull()
      expect(container.querySelector(`label[for="${textarea.id}"]`)).not.toBeNull()
      const exportButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Esporta'))!
      await act(async () => exportButton.click())
      expect(onExport).toHaveBeenCalledOnce()
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label]')!.click())
      expect(onDismiss).toHaveBeenCalledOnce()
    } finally {
      await act(async () => root.unmount())
    }
  })
})
