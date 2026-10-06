import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IngestedDocument } from '../types'
import { I18nProvider } from '../i18n'

const documentsStore: { documents: IngestedDocument[]; notify?: (docs: IngestedDocument[]) => void } = { documents: [] }

vi.mock('./useIngestedDocuments', () => ({
  notifyDocumentsChanged: vi.fn(),
  useIngestedDocuments: ({ onDocsUpdated }: { onDocsUpdated: (docs: IngestedDocument[]) => void }) => {
    documentsStore.notify = onDocsUpdated
    return { documents: documentsStore.documents, refetchDocuments: vi.fn(async () => {}) }
  },
}))
vi.mock('./useOllamaModelMetrics', () => ({ useOllamaModelMetrics: () => ({ metrics: {} }) }))

import { useIngestion } from './useIngestion'
import { clearDocumentMarkdownCache, peekDocumentMarkdown, primeDocumentMarkdown } from '../services/documentMarkdown'

const docA = { id: 'a', filename: 'a.md', fileType: 'text', numPages: 1, ingestedAt: 't1' } as IngestedDocument
const docB = { id: 'b', filename: 'b.md', fileType: 'text', numPages: 1, ingestedAt: 't1' } as IngestedDocument

describe('useIngestion loads the selected document on demand', () => {
  let container: HTMLDivElement
  let root: Root
  let ingestion: ReturnType<typeof useIngestion>
  const pending = new Map<string, (markdown: string) => void>()
  const getIngestedDocument = vi.fn(
    ({ docId }: { docId: string }) =>
      new Promise((resolve) => {
        pending.set(docId, (markdown) => resolve({ ...documentsStore.documents.find((doc) => doc.id === docId), extractedMarkdown: markdown }))
      }),
  )

  function Harness() {
    ingestion = useIngestion()
    return null
  }

  async function resolveDocument(docId: string, markdown: string) {
    await act(async () => {
      pending.get(docId)?.(markdown)
      await Promise.resolve()
    })
  }

  beforeEach(async () => {
    documentsStore.documents = [docA, docB]
    pending.clear()
    getIngestedDocument.mockClear()
    clearDocumentMarkdownCache()
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { getIngestedDocument }
    container = document.createElement('div')
    root = createRoot(container)
    await act(async () =>
      root.render(
        <I18nProvider initialLanguage="en">
          <Harness />
        </I18nProvider>,
      ),
    )
    await act(async () => documentsStore.notify?.(documentsStore.documents))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
  })

  it('never shows the previous document while the next one loads', async () => {
    await resolveDocument('a', '# A')
    expect(ingestion.selectedDoc?.id).toBe('a')
    expect(ingestion.markdownContent).toBe('# A')

    await act(async () => ingestion.handleSelectDoc(docB))
    expect(ingestion.markdownContent).toBe('')
    expect(ingestion.isDirty).toBe(false)

    await resolveDocument('b', '# B')
    expect(ingestion.markdownContent).toBe('# B')
  })

  it('preserves typing during loading without allowing an unbound save', async () => {
    const updateIngestedDocument = vi.fn()
    window.electronAPI = { ...window.electronAPI!, updateIngestedDocument }
    await act(async () => ingestion.setMarkdownContent('# A typed while loading'))
    await act(async () => ingestion.handleSaveDocument())
    expect(updateIngestedDocument).not.toHaveBeenCalled()
    await act(async () => ingestion.handleSelectDoc(docB))
    await act(async () => ingestion.handleSelectDoc(docA))
    await resolveDocument('a', '# A loaded')
    expect(ingestion.markdownContent).toBe('# A typed while loading')
    expect(ingestion.isDirty).toBe(true)
  })

  it('discards a clean saved draft so external revisions can load', async () => {
    await resolveDocument('a', '# A')
    await act(async () => ingestion.setMarkdownContent('# A saved'))
    window.electronAPI = {
      ...window.electronAPI!,
      updateIngestedDocument: vi.fn(async () => ({ success: true, data: { ...docA, ingestedAt: 't2', extractedMarkdown: '# A saved' } })),
    }
    await act(async () => ingestion.handleSaveDocument())
    expect(ingestion.isDirty).toBe(false)
    const external = { ...docA, ingestedAt: 't3', extractedMarkdown: '# A external' }
    primeDocumentMarkdown(external)
    await act(async () => documentsStore.notify?.([external, docB]))
    expect(ingestion.markdownContent).toBe('# A external')
    expect(ingestion.isDirty).toBe(false)
  })

  it('keeps unsaved edits when the list refreshes the same document', async () => {
    await resolveDocument('a', '# A')
    await act(async () => ingestion.setMarkdownContent('# A edited'))
    expect(ingestion.isDirty).toBe(true)

    await act(async () => documentsStore.notify?.([{ ...docA }, docB]))

    expect(ingestion.selectedDoc?.id).toBe('a')
    expect(ingestion.markdownContent).toBe('# A edited')
    expect(getIngestedDocument).toHaveBeenCalledTimes(1)
  })

  it('restores unsaved drafts when navigating back to a document', async () => {
    await resolveDocument('a', '# A')
    await act(async () => ingestion.setMarkdownContent('# A draft'))
    await act(async () => ingestion.handleSelectDoc(docB))
    await resolveDocument('b', '# B')
    await act(async () => ingestion.setMarkdownContent('# B draft'))
    await act(async () => ingestion.handleSelectDoc(docA))
    expect(ingestion.markdownContent).toBe('# A draft')
    expect(ingestion.isDirty).toBe(true)
    await act(async () => ingestion.handleSelectDoc(docB))
    expect(ingestion.markdownContent).toBe('# B draft')
  })

  it('updates a saved document cache without replacing a newer selection', async () => {
    await resolveDocument('a', '# A')
    await act(async () => ingestion.setMarkdownContent('# A saved'))
    let finish!: (result: unknown) => void
    window.electronAPI = {
      ...window.electronAPI!,
      updateIngestedDocument: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      ) as NonNullable<typeof window.electronAPI>['updateIngestedDocument'],
    }
    let saving!: Promise<void>
    await act(async () => {
      saving = ingestion.handleSaveDocument()
    })
    await act(async () => ingestion.handleSelectDoc(docB))
    await resolveDocument('b', '# B')
    await act(async () => ingestion.setMarkdownContent('# B draft'))
    const saved = { ...docA, ingestedAt: 't2', extractedMarkdown: '# A saved' }
    await act(async () => {
      finish({ success: true, data: saved })
      await saving
    })
    expect(ingestion.selectedDoc?.id).toBe('b')
    expect(ingestion.markdownContent).toBe('# B draft')
    expect(ingestion.saveStatus).toBeNull()
    expect(peekDocumentMarkdown(saved)).toBe('# A saved')
    await act(async () => ingestion.handleSelectDoc(saved))
    expect(ingestion.markdownContent).toBe('# A saved')
    expect(ingestion.isDirty).toBe(false)
  })

  it('preserves edits made after Save and serializes duplicate save calls', async () => {
    await resolveDocument('a', '# A')
    await act(async () => ingestion.setMarkdownContent('# A saved'))
    let finish!: (result: unknown) => void
    const update = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    window.electronAPI = { ...window.electronAPI!, updateIngestedDocument: update as NonNullable<typeof window.electronAPI>['updateIngestedDocument'] }
    let saving!: Promise<void>
    await act(async () => {
      saving = ingestion.handleSaveDocument()
      void ingestion.handleSaveDocument()
    })
    expect(update).toHaveBeenCalledTimes(1)
    await act(async () => ingestion.setMarkdownContent('# A newer draft'))
    await act(async () => {
      finish({ success: true, data: { ...docA, ingestedAt: 't2', extractedMarkdown: '# A saved' } })
      await saving
    })
    expect(update).toHaveBeenCalledTimes(1)
    expect(ingestion.markdownContent).toBe('# A newer draft')
    expect(ingestion.isDirty).toBe(true)
    await act(async () => ingestion.handleSelectDoc(docB))
    await act(async () => ingestion.handleSelectDoc({ ...docA, ingestedAt: 't2' }))
    expect(ingestion.markdownContent).toBe('# A newer draft')
  })

  it('keeps the draft after a failed save', async () => {
    await resolveDocument('a', '# A')
    await act(async () => ingestion.setMarkdownContent('# A draft'))
    window.electronAPI = { ...window.electronAPI!, updateIngestedDocument: vi.fn(async () => ({ success: false, error: 'Save refused' })) }
    await act(async () => ingestion.handleSaveDocument())
    expect(ingestion.saveStatus).toEqual({ success: false, message: 'Save refused' })
    expect(ingestion.isSaving).toBe(false)
    expect(ingestion.isDirty).toBe(true)
    await act(async () => ingestion.handleSelectDoc(docB))
    await act(async () => ingestion.handleSelectDoc(docA))
    expect(ingestion.markdownContent).toBe('# A draft')
  })

  it('keeps an independently refreshed revision when an older save settles', async () => {
    await resolveDocument('a', '# A')
    await act(async () => ingestion.setMarkdownContent('# A saved'))
    let finish!: (result: unknown) => void
    window.electronAPI = {
      ...window.electronAPI!,
      updateIngestedDocument: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      ) as NonNullable<typeof window.electronAPI>['updateIngestedDocument'],
    }
    let saving!: Promise<void>
    await act(async () => {
      saving = ingestion.handleSaveDocument()
    })
    const refreshed = { ...docA, ingestedAt: 't3', extractedMarkdown: '# A external' }
    primeDocumentMarkdown(refreshed)
    await act(async () => documentsStore.notify?.([refreshed, docB]))
    await act(async () => ingestion.setMarkdownContent('# A new draft'))
    await act(async () => {
      finish({ success: true, data: { ...docA, ingestedAt: 't2', extractedMarkdown: '# A saved' } })
      await saving
    })
    expect(ingestion.selectedDoc?.ingestedAt).toBe('t3')
    expect(ingestion.markdownContent).toBe('# A new draft')
    expect(ingestion.isDirty).toBe(true)
  })

  it('preserves a return to the original text while a different snapshot saves', async () => {
    await resolveDocument('a', '# A')
    await act(async () => ingestion.setMarkdownContent('# A saved'))
    let finish!: (result: unknown) => void
    window.electronAPI = {
      ...window.electronAPI!,
      updateIngestedDocument: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      ) as NonNullable<typeof window.electronAPI>['updateIngestedDocument'],
    }
    let saving!: Promise<void>
    await act(async () => {
      saving = ingestion.handleSaveDocument()
    })
    await act(async () => ingestion.setMarkdownContent('# A'))
    await act(async () => ingestion.handleSelectDoc(docB))
    await act(async () => {
      finish({ success: true, data: { ...docA, ingestedAt: 't2', extractedMarkdown: '# A saved' } })
      await saving
    })
    await act(async () => ingestion.handleSelectDoc({ ...docA, ingestedAt: 't2' }))
    expect(ingestion.markdownContent).toBe('# A')
    expect(ingestion.isDirty).toBe(true)
  })

  it('retains and exports a review draft without replacing the selected document or indexing it', async () => {
    await resolveDocument('a', '# A')
    await act(async () => ingestion.setMarkdownContent('# A edited'))
    const review = { originalMarkdown: '# Original\n\nAB123 retained.', issues: [{ page: 1, reason: 'truncated' }] }
    const ingestFile = vi.fn(async () => ({ success: false, error: 'Review required', normalizationReview: review }))
    const exportDocument = vi.fn(async () => ({ success: true }))
    const updateIngestedDocument = vi.fn()
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { getIngestedDocument, ingestFile, exportDocument, updateIngestedDocument }

    await act(async () => ingestion.handleIngestPath('C:/fixtures/review.pdf'))

    expect(ingestion.normalizationReview).toEqual(review)
    expect(ingestion.selectedDoc?.id).toBe('a')
    expect(ingestion.markdownContent).toBe('# A edited')
    expect(ingestion.isUploading).toBe(false)
    expect(ingestion.ingestionProgress.active).toBe(false)
    expect(documentsStore.documents).toEqual([docA, docB])
    expect(updateIngestedDocument).not.toHaveBeenCalled()
    await act(async () => ingestion.handleExportNormalizationReview())
    expect(exportDocument).toHaveBeenCalledWith({ markdownContent: review.originalMarkdown, format: 'md' })
    await act(async () => ingestion.dismissNormalizationReview())
    expect(ingestion.normalizationReview).toBeNull()
    expect(ingestion.markdownContent).toBe('# A edited')
  })
})
