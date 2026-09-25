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
import { clearDocumentMarkdownCache } from '../services/documentMarkdown'

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
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
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

  it('keeps unsaved edits when the list refreshes the same document', async () => {
    await resolveDocument('a', '# A')
    await act(async () => ingestion.setMarkdownContent('# A edited'))
    expect(ingestion.isDirty).toBe(true)

    await act(async () => documentsStore.notify?.([{ ...docA }, docB]))

    expect(ingestion.selectedDoc?.id).toBe('a')
    expect(ingestion.markdownContent).toBe('# A edited')
    expect(getIngestedDocument).toHaveBeenCalledTimes(1)
  })
})
