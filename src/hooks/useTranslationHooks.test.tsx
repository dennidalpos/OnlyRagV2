import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings, IngestedDocument } from '../types'
import { I18nProvider } from '../i18n'

const documentsStore: { documents: IngestedDocument[] } = { documents: [] }

vi.mock('./useIngestedDocuments', () => ({
  useIngestedDocuments: ({ onDocsUpdated }: { onDocsUpdated: (docs: IngestedDocument[]) => void }) => {
    queueMicrotask(() => onDocsUpdated(documentsStore.documents))
    return { documents: documentsStore.documents, refetchDocuments: vi.fn(async () => {}) }
  },
}))
vi.mock('./useOllamaModelMetrics', () => ({ useOllamaModelMetrics: () => ({ metrics: {} }) }))

import { useDocumentTranslation, useInplaceTranslation } from './useTranslation'
import { clearDocumentMarkdownCache } from '../services/documentMarkdown'
import { peekGlobalTaskLock } from '../services/globalTaskLock'
import type { TranslateProgressPayload } from '../types'

// The list carries metadata only; the Markdown comes from getIngestedDocument on demand.
const markdownDoc = { id: 'md-1', filename: 'notes.md', fileType: 'md', numPages: 1, ingestedAt: 't1' } as unknown as IngestedDocument
const pdfDoc = { id: 'pdf-1', filename: 'report.pdf', fileType: 'pdf', numPages: 1, ingestedAt: 't1' } as unknown as IngestedDocument
const storedMarkdown: Record<string, string> = { 'md-1': '# Notes\n\nCiao', 'pdf-1': '# Report' }

describe('translation hooks', () => {
  let container: HTMLDivElement
  let root: Root
  let documentTranslation: ReturnType<typeof useDocumentTranslation>
  let inplaceTranslation: ReturnType<typeof useInplaceTranslation>
  const generateOllamaStream = vi.fn()
  const getIngestedDocument = vi.fn(async ({ docId }: { docId: string }) =>
    docId in storedMarkdown ? { ...documentsStore.documents.find((doc) => doc.id === docId), extractedMarkdown: storedMarkdown[docId] } : null,
  )

  function Harness({ settings }: { settings: AppSettings }) {
    documentTranslation = useDocumentTranslation(settings)
    inplaceTranslation = useInplaceTranslation(settings)
    return null
  }

  async function render(settings: Partial<AppSettings>) {
    await act(async () =>
      root.render(
        <I18nProvider initialLanguage="en">
          <Harness settings={settings as AppSettings} />
        </I18nProvider>,
      ),
    )
    await act(async () => Promise.resolve())
  }

  beforeEach(() => {
    documentsStore.documents = [markdownDoc, pdfDoc]
    generateOllamaStream.mockReset()
    getIngestedDocument.mockClear()
    clearDocumentMarkdownCache()
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { generateOllamaStream, getIngestedDocument }
    container = document.createElement('div')
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
  })

  it('offers every document to the Markdown translator but only PDF/DOCX to the layout translator', async () => {
    await render({ defaultModel: 'model:latest' })

    expect(documentTranslation.documents.map((doc) => doc.id)).toEqual(['md-1', 'pdf-1'])
    expect(documentTranslation.selectedDoc?.id).toBe('md-1')
    expect(inplaceTranslation.documents.map((doc) => doc.id)).toEqual(['pdf-1'])
    expect(inplaceTranslation.selectedDoc?.id).toBe('pdf-1')
  })

  it('swaps the language pair', async () => {
    await render({ defaultModel: 'model:latest' })
    await act(async () => documentTranslation.handleSwapLanguages())
    expect([documentTranslation.sourceLang, documentTranslation.targetLang]).toEqual(['English', 'Italian'])
  })

  it('refuses to translate without a configured model instead of guessing one', async () => {
    await render({})

    await act(async () => documentTranslation.handleStartTranslation())

    expect(generateOllamaStream).not.toHaveBeenCalled()
    expect(documentTranslation.translationError).toMatch(/No translation model is configured/)
    expect(documentTranslation.isTranslating).toBe(false)
  })

  it('translates with the configured translation model', async () => {
    generateOllamaStream.mockImplementation(async (_request: unknown, onChunk: (chunk: string) => void) => {
      onChunk('Hello')
      return { success: true }
    })
    await render({ defaultModel: 'fallback:latest', translationModel: 'translator:latest' })

    await act(async () => documentTranslation.handleStartTranslation())

    expect(generateOllamaStream).toHaveBeenCalledWith(
      {
        model: 'translator:latest',
        prompt: expect.stringContaining('Ciao'),
        options: expect.objectContaining({ think: false }),
        host: undefined,
        operationId: expect.any(String),
      },
      expect.any(Function),
    )
    expect(documentTranslation.selectedDocMarkdown).toBe('# Notes\n\nCiao')
    expect(documentTranslation.isTranslationComplete).toBe(true)
    expect(documentTranslation.translatedMarkdown).toBe('Hello')
  })

  it('ignores old chunks, completion and cancellation settlement after Stop and restart', async () => {
    const runs: { chunk: (text: string) => void; finish: (result: { success: boolean; error?: string }) => void }[] = []
    generateOllamaStream.mockImplementation((_request: unknown, chunk: (text: string) => void) => new Promise((finish) => runs.push({ chunk, finish })))
    let finishCancel!: () => void
    window.electronAPI = {
      ...window.electronAPI!,
      cancelOllamaStream: vi.fn(
        () =>
          new Promise<{ success: boolean }>((resolve) => {
            finishCancel = () => resolve({ success: true })
          }),
      ),
    }
    await render({ translationModel: 'translator:latest' })
    let first!: Promise<void>
    await act(async () => {
      first = documentTranslation.handleStartTranslation()
    })
    await act(async () => runs[0].chunk('Partial'))
    let stopping!: Promise<void>
    await act(async () => {
      stopping = documentTranslation.handleStopTranslation()
    })
    expect(documentTranslation.isTranslationComplete).toBe(false)
    expect(documentTranslation.translatedMarkdown).toBe('Partial')
    let second!: Promise<void>
    await act(async () => {
      second = documentTranslation.handleStartTranslation()
    })
    await act(async () => {
      runs[1].chunk('NEW')
      runs[0].chunk('OLD')
      runs[0].finish({ success: true })
      await first
      finishCancel()
      await stopping
    })
    expect(documentTranslation.translatedMarkdown).toBe('NEW')
    expect(documentTranslation.isTranslating).toBe(true)
    expect(documentTranslation.isTranslationComplete).toBe(false)
    expect(documentTranslation.generationState).toBe('queued')
    await act(async () => {
      runs[1].finish({ success: true })
      await second
    })
    expect(documentTranslation.translatedMarkdown).toBe('NEW')
    expect(documentTranslation.isTranslationComplete).toBe(true)
  })

  it('invalidates completed output when its language pair or source changes', async () => {
    const exportDocument = vi.fn(async () => ({ success: true }))
    window.electronAPI = { ...window.electronAPI!, exportDocument }
    generateOllamaStream.mockImplementation(async (_request: unknown, chunk: (text: string) => void) => {
      chunk('Hello')
      return { success: true }
    })
    await render({ translationModel: 'translator:latest' })
    await act(async () => documentTranslation.handleStartTranslation())
    await act(async () => documentTranslation.setTargetLang('French'))
    expect(documentTranslation.isTranslationComplete).toBe(false)
    await act(async () => documentTranslation.handleExportTranslation('md'))
    expect(exportDocument).not.toHaveBeenCalled()
    await act(async () => documentTranslation.handleStartTranslation())
    await act(async () => documentTranslation.setSelectedDoc(pdfDoc))
    expect(documentTranslation.isTranslationComplete).toBe(false)
    expect(documentTranslation.translatedMarkdown).toBe('')
  })

  it('reports a document whose Markdown cannot be loaded instead of translating an empty text', async () => {
    getIngestedDocument.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    await render({ translationModel: 'translator:latest' })

    await act(async () => documentTranslation.handleStartTranslation())

    expect(generateOllamaStream).not.toHaveBeenCalled()
    expect(documentTranslation.translationError).toMatch(/Could not load the document content/)
    expect(documentTranslation.isTranslating).toBe(false)
  })

  it('can stop before the first progress and waits for confirmed cancellation', async () => {
    let finish!: (result: { success: boolean; cancelled?: boolean }) => void
    let progress!: (payload: TranslateProgressPayload) => void
    const translate = vi.fn(
      (_request: { taskId: string }) =>
        new Promise<{ success: boolean; cancelled?: boolean }>((resolve) => {
          finish = resolve
        }),
    )
    const cancelTask = vi.fn(async () => ({ success: true }))
    window.electronAPI = {
      ...window.electronAPI!,
      translateDocumentInplace: translate,
      cancelTask,
      onTranslateProgress: (callback) => {
        progress = callback
        return () => {}
      },
    }
    await render({ translationModel: 'translator', translationOutputFolder: 'D:/fixture' })
    let running!: Promise<void>
    await act(async () => {
      running = inplaceTranslation.handleStartInplaceTranslation()
    })
    // The request carries its identity before the Sidecar produces any event.
    const request = translate.mock.calls[0][0]
    expect(request.taskId).toBeTypeOf('string')
    expect(inplaceTranslation.canCancel).toBe(true)
    await act(async () => progress({ type: 'progress', taskId: 'unrelated', percent: 80 }))
    expect(inplaceTranslation.translateProgress).toBeNull()
    await act(async () => inplaceTranslation.handleCancelInplaceTranslation())
    expect(cancelTask).toHaveBeenCalledWith({ taskId: request.taskId })
    expect(inplaceTranslation.isTranslating).toBe(true)
    expect(peekGlobalTaskLock()).toBe('translation')
    await act(async () => {
      finish({ success: false, cancelled: true })
      await running
    })
    expect(inplaceTranslation.status?.message).toMatch(/cancel/i)
    expect(peekGlobalTaskLock()).toBeNull()
  })

  it('cancels on unmount and holds the global lock until the old operation settles', async () => {
    let finish!: (result: { success: boolean; error?: string }) => void
    const translate = vi.fn(
      () =>
        new Promise<{ success: boolean; error?: string }>((resolve) => {
          finish = resolve
        }),
    )
    const cancelTask = vi.fn(async () => ({ success: true }))
    window.electronAPI = { ...window.electronAPI!, translateDocumentInplace: translate, cancelTask }
    const settings = { translationModel: 'translator', translationOutputFolder: 'D:/fixture' }
    await render(settings)
    let running!: Promise<void>
    await act(async () => {
      running = inplaceTranslation.handleStartInplaceTranslation()
    })
    await act(async () => root.unmount())
    expect(cancelTask).toHaveBeenCalledOnce()
    expect(peekGlobalTaskLock()).toBe('translation')
    root = createRoot(container)
    await render(settings)
    await act(async () => inplaceTranslation.handleStartInplaceTranslation())
    expect(translate).toHaveBeenCalledOnce()
    await act(async () => {
      finish({ success: false, error: 'Server stopped' })
      await running
    })
    expect(peekGlobalTaskLock()).toBeNull()
    expect(inplaceTranslation.isTranslating).toBe(false)
  })

  it('keeps a failed cancellation distinct from a server cancellation terminal', async () => {
    let finish!: (result: { success: boolean; error?: string }) => void
    window.electronAPI = {
      ...window.electronAPI!,
      translateDocumentInplace: vi.fn(
        () =>
          new Promise<{ success: boolean; error?: string }>((resolve) => {
            finish = resolve
          }),
      ),
      cancelTask: vi.fn(async () => ({ success: false, message: 'Relay unavailable' })),
    }
    await render({ translationModel: 'translator', translationOutputFolder: 'D:/fixture' })
    let running!: Promise<void>
    await act(async () => {
      running = inplaceTranslation.handleStartInplaceTranslation()
    })
    await act(async () => inplaceTranslation.handleCancelInplaceTranslation())
    expect(inplaceTranslation.status?.message).toBe('Relay unavailable')
    expect(inplaceTranslation.isTranslating).toBe(true)
    expect(inplaceTranslation.isCancelling).toBe(false)
    await act(async () => {
      finish({ success: false, error: 'Storage failure' })
      await running
    })
    expect(inplaceTranslation.status?.message).toBe('Storage failure')
  })

  it.each(['pdf', 'docx'])('releases a %s job after transport loss and ignores late progress for its old identity', async (fileType) => {
    documentsStore.documents = [{ ...pdfDoc, id: `transport-${fileType}`, filename: `fixture.${fileType}`, fileType } as IngestedDocument]
    let reject!: (reason: Error) => void
    let progress!: (payload: TranslateProgressPayload) => void
    const translate = vi.fn(
      (_request: { taskId: string }) =>
        new Promise<{ success: boolean }>((_resolve, fail) => {
          reject = fail
        }),
    )
    window.electronAPI = {
      ...window.electronAPI!,
      translateDocumentInplace: translate,
      cancelTask: vi.fn(async () => ({ success: true })),
      onTranslateProgress: (callback) => {
        progress = callback
        return () => {}
      },
    }
    await render({ translationModel: 'translator', translationOutputFolder: 'D:/fixture' })
    let running!: Promise<void>
    await act(async () => {
      running = inplaceTranslation.handleStartInplaceTranslation()
    })
    const request = translate.mock.calls[0]
    expect(request[0].taskId).toBeTruthy()
    expect(peekGlobalTaskLock()).toBe('translation')
    await act(async () => {
      reject(new Error('Controlled transport loss'))
      await running
    })
    expect(inplaceTranslation.status?.success).toBe(false)
    expect(inplaceTranslation.status?.message).toContain('Controlled transport loss')
    expect(inplaceTranslation.status?.message).not.toMatch(/cancelled/i)
    expect(peekGlobalTaskLock()).toBeNull()
    await act(async () => progress({ taskId: request[0].taskId, type: 'progress', page: 9, total_pages: 9, percent: 100 }))
    expect(inplaceTranslation.translateProgress).toBeNull()
  })
})
