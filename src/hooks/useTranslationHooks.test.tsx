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
  const getIngestedDocument = vi.fn(async (docId: string) =>
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
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
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
    act(() => documentTranslation.handleSwapLanguages())
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
    generateOllamaStream.mockImplementation(async (_model: string, _prompt: string, onChunk: (chunk: string) => void) => {
      onChunk('Hello')
      return { success: true }
    })
    await render({ defaultModel: 'fallback:latest', translationModel: 'translator:latest' })

    await act(async () => documentTranslation.handleStartTranslation())

    expect(generateOllamaStream).toHaveBeenCalledWith(
      'translator:latest',
      expect.any(String),
      expect.any(Function),
      expect.objectContaining({ think: false }),
      undefined,
      expect.any(String),
    )
    expect(generateOllamaStream.mock.calls[0][1]).toContain('Ciao')
    expect(documentTranslation.selectedDocMarkdown).toBe('# Notes\n\nCiao')
    expect(documentTranslation.isTranslationComplete).toBe(true)
    expect(documentTranslation.translatedMarkdown).toBe('Hello')
  })

  it('reports a document whose Markdown cannot be loaded instead of translating an empty text', async () => {
    getIngestedDocument.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    await render({ translationModel: 'translator:latest' })

    await act(async () => documentTranslation.handleStartTranslation())

    expect(generateOllamaStream).not.toHaveBeenCalled()
    expect(documentTranslation.translationError).toMatch(/Could not load the document content/)
    expect(documentTranslation.isTranslating).toBe(false)
  })
})
