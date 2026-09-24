import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings, IngestedDocument, TranslateProgressPayload } from '../../types'
import { I18nProvider } from '../../i18n'

const pdfDoc = { id: 'pdf-1', filename: 'report.pdf', fileType: 'pdf', numPages: 2, ingestedAt: 't1' } as IngestedDocument

vi.mock('@monaco-editor/react', () => ({ default: () => null, DiffEditor: () => null }))
vi.mock('../../lib/monacoTheme', () => ({ ONLYRAG_MONACO_THEME_NAME: 'test', defineOnlyRagMonacoTheme: () => {}, getStandardMonacoOptions: () => ({}) }))
vi.mock('../../hooks/useOllamaModelMetrics', () => ({ useOllamaModelMetrics: () => ({ metrics: {} }) }))
vi.mock('../../hooks/useIngestedDocuments', () => ({
  useIngestedDocuments: ({ onDocsUpdated }: { onDocsUpdated: (docs: IngestedDocument[]) => void }) => {
    queueMicrotask(() => onDocsUpdated([pdfDoc]))
    return { documents: [pdfDoc], refetchDocuments: vi.fn(async () => {}) }
  },
}))

import { TranslationView } from './TranslationView'
import { peekGlobalTaskLock } from '../../services/globalTaskLock'

describe('TranslationView in-place job lifecycle', () => {
  let container: HTMLDivElement
  let root: Root
  let emitProgress: (payload: TranslateProgressPayload) => void = () => {}
  let finishTranslation: (result: { success: boolean; error?: string }) => void = () => {}
  const cancelTask = vi.fn(async () => ({ success: true }))
  const translateDocumentInplace = vi.fn(
    () =>
      new Promise((resolve) => {
        finishTranslation = resolve
      }),
  )
  const settings = { translationModel: 'translator:latest', translationOutputFolder: 'C:/out' } as AppSettings

  const tab = (label: RegExp) => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => label.test(button.textContent || ''))!
  const button = (label: RegExp) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => label.test(candidate.textContent || ''))!
  const click = (element: HTMLElement) => act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))

  beforeEach(async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    cancelTask.mockClear()
    translateDocumentInplace.mockClear()
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      translateDocumentInplace,
      cancelTask,
      onTranslateProgress: (callback: (payload: TranslateProgressPayload) => void) => {
        emitProgress = callback
        return () => {}
      },
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () =>
      root.render(
        <I18nProvider initialLanguage="en">
          <TranslationView settings={settings} diagnostics={null} />
        </I18nProvider>,
      ),
    )
    await act(async () => Promise.resolve())
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('keeps the job, its progress and the task lock across tab switches, and cancels it', async () => {
    await click(tab(/Layout-Preserving/))
    await click(button(/Start Layout-Preserving Translation/))
    await act(async () => emitProgress({ taskId: 'translate-1', type: 'progress', percent: 40 }))
    expect(peekGlobalTaskLock()).toBe('translation')

    await click(tab(/Text & Markdown/))
    expect(peekGlobalTaskLock()).toBe('translation')
    // One job at a time per view: the Markdown translator waits for the layout job.
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Start Translation"]')?.disabled).toBe(true)

    await click(tab(/Layout-Preserving/))
    expect(container.textContent).toContain('40')
    await click(button(/^Cancel$/))
    expect(cancelTask).toHaveBeenCalledWith('translate-1')

    await act(async () => finishTranslation({ success: false, error: 'socket hang up' }))
    expect(container.textContent).toContain('Translation cancelled')
    expect(peekGlobalTaskLock()).toBeNull()
    await click(tab(/Text & Markdown/))
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Start Translation"]')?.disabled).toBe(false)
  })

  it('shares the language pair between the two translators', async () => {
    const swap = container.querySelector<HTMLButtonElement>('button[aria-label*="wap" i], button[title*="wap" i]')
    expect(swap).not.toBeNull()
    await click(swap!)
    await click(tab(/Layout-Preserving/))
    const selects = [...container.querySelectorAll<HTMLSelectElement>('select')].map((select) => select.value)
    expect(selects).toEqual(expect.arrayContaining(['English', 'Italian']))
    expect(selects.indexOf('English')).toBeLessThan(selects.indexOf('Italian'))
  })
})
