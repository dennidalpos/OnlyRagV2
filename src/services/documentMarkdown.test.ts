import { beforeEach, describe, expect, it, vi } from 'vitest'

const getIngestedDocument = vi.fn()
vi.mock('./api', () => ({ apiService: { getIngestedDocument: (docId: string) => getIngestedDocument(docId) } }))

import { clearDocumentMarkdownCache, loadDocumentMarkdown, peekDocumentMarkdown, primeDocumentMarkdown } from './documentMarkdown'

const doc = (id: string, ingestedAt = 't1') => ({ id, ingestedAt })

describe('on-demand document Markdown', () => {
  beforeEach(() => {
    clearDocumentMarkdownCache()
    getIngestedDocument.mockReset()
    getIngestedDocument.mockImplementation(async (id: string) => ({ ...doc(id), extractedMarkdown: `# ${id}` }))
  })

  it('loads a document once per version and shares the in-flight request', async () => {
    const [first, second] = await Promise.all([loadDocumentMarkdown(doc('a')), loadDocumentMarkdown(doc('a'))])
    await loadDocumentMarkdown(doc('a'))

    expect([first, second]).toEqual(['# a', '# a'])
    expect(getIngestedDocument).toHaveBeenCalledTimes(1)
    expect(peekDocumentMarkdown(doc('a'))).toBe('# a')
    expect(peekDocumentMarkdown(doc('a', 't2'))).toBeUndefined()
  })

  it('never serves an edited document from the previous version', async () => {
    primeDocumentMarkdown({ ...doc('a', 't1'), extractedMarkdown: 'old' } as never)
    primeDocumentMarkdown({ ...doc('a', 't2'), extractedMarkdown: 'new' } as never)

    expect(await loadDocumentMarkdown(doc('a', 't2'))).toBe('new')
    expect(getIngestedDocument).not.toHaveBeenCalled()
  })

  it('returns null for a missing document and retries it later', async () => {
    getIngestedDocument.mockResolvedValueOnce(null)

    expect(await loadDocumentMarkdown(doc('gone'))).toBeNull()
    expect(await loadDocumentMarkdown(doc('gone'))).toBe('# gone')
  })

  it('keeps a bounded number of documents', async () => {
    for (let index = 0; index < 12; index++) await loadDocumentMarkdown(doc(`d${index}`))

    expect(peekDocumentMarkdown(doc('d0'))).toBeUndefined()
    expect(peekDocumentMarkdown(doc('d11'))).toBe('# d11')
  })
})
