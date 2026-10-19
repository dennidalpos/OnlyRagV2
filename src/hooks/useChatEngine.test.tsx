import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings, IngestedDocument, IngestedDocumentContent, VectorSearchResult } from '../types'
import { I18nProvider } from '../i18n'
import { DEFAULT_APP_SETTINGS } from '../../shared/domain/settings/appSettingsDefaults'
import { primeDocumentMarkdown, clearDocumentMarkdownCache } from '../services/documentMarkdown'
import { OllamaGenerationScheduler } from '../../electron/core/infrastructure/http/ollamaGenerationScheduler'
import { resolvePromptCharBudget } from '../services/chatContextBudget'

const documentStore: { documents: IngestedDocument[] } = { documents: [] }
const metricStore: { metrics: Record<string, { contextLength: number; capabilities: string[] }> } = { metrics: {} }
vi.mock('./useIngestedDocuments', () => ({
  useIngestedDocuments: () => ({ documents: documentStore.documents, refetchDocuments: vi.fn() }),
}))
vi.mock('./useOllamaModelMetrics', () => ({ useOllamaModelMetrics: () => ({ metrics: metricStore.metrics }) }))

import { useChatEngine } from './useChatEngine'

const docA = { id: 'a', filename: 'a.md', fileType: 'text', numPages: 1, ingestedAt: 't1' } as IngestedDocument
const docB = { ...docA, id: 'b', filename: 'b.md' }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept
    reject = refuse
  })
  return { promise, resolve, reject }
}

describe('chat document grounding', () => {
  let root: Root
  let chat: ReturnType<typeof useChatEngine>
  let settingsOverride: Partial<AppSettings> = {}
  let recovery: import('../../shared/domain/chatHistory').ChatHistoryRecovery
  const getIngestedDocuments = vi.fn(async () => documentStore.documents as IngestedDocument[] | null)
  const getIngestedDocument = vi.fn(
    async ({ docId }: { docId: string }): Promise<IngestedDocumentContent | null> => ({
      ...(docId === 'a' ? docA : docB),
      extractedMarkdown: `Readable ${docId}`,
    }),
  )
  const searchVectorDb = vi.fn(async (): Promise<VectorSearchResult[]> => [])
  const generateOllamaStream = vi.fn(async (_request: { prompt: string; operationId: string }, onChunk: (chunk: string) => void) => {
    onChunk('Fixture answer')
    return { success: true }
  })
  const cancelOllamaStream = vi.fn(async () => ({ success: true }))

  function Harness() {
    chat = useChatEngine({ ...DEFAULT_APP_SETTINGS, defaultModel: 'fixture-model', ...settingsOverride }, null)
    return (
      <div>
        {chat.messages.map((message) => (
          <p key={message.id}>{message.text}</p>
        ))}
      </div>
    )
  }
  async function send(ids: string[] = ['a']) {
    await act(async () => {
      for (const id of ids) chat.toggleDocSelection(id)
      chat.setInput('Find the delivery deadline in these documents')
    })
    await act(async () => chat.handleSendMessage())
  }
  async function start(ids: string[] = ['a']) {
    await act(async () => {
      for (const id of ids) chat.toggleDocSelection(id)
      chat.setInput('Find the delivery deadline in these documents')
    })
    let completion!: Promise<void>
    await act(async () => {
      completion = chat.handleSendMessage()
    })
    return { completion }
  }
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    settingsOverride = {}
    metricStore.metrics = {}
    recovery = { revision: 'missing', state: null }
    documentStore.documents = [docA, docB]
    localStorage.clear()
    clearDocumentMarkdownCache()
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      getIngestedDocuments,
      getIngestedDocument,
      searchVectorDb,
      generateOllamaStream,
      cancelOllamaStream,
      loadChatRecovery: vi.fn(async () => structuredClone(recovery)),
      saveChatRecovery: vi.fn(async (snapshot: import('../../shared/domain/chatHistory').ChatHistoryRecovery) => {
        recovery = structuredClone(snapshot)
        return recovery
      }),
    }
    root = createRoot(document.createElement('div'))
    await act(async () =>
      root.render(
        <I18nProvider initialLanguage="en">
          <Harness />
        </I18nProvider>,
      ),
    )
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    vi.useRealTimers()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('stops generation after retrieval failure even when all document text loads', async () => {
    searchVectorDb.mockRejectedValueOnce(new Error('search down'))
    await send()
    expect(generateOllamaStream).not.toHaveBeenCalled()
    expect(chat.messages.at(-1)?.text).toContain('Document search failed')
    expect(chat.messages.at(-1)?.text).toContain('1/1 documents loaded')
    expect(chat.messages.at(-1)?.sources).toBeUndefined()
    expect(chat.isGenerating).toBe(false)
  })

  it.each([
    ['medicalModel', 'Antibiotic therapy for pneumonia', 'medical-fixture', 2048, undefined, 2048],
    ['legalModel', 'Contratto clausola risarcimento tribunale', 'legal-fixture', 8192, 3072, 3072],
  ] as const)('sizes the turn for the routed %s rather than the general model', async (role, query, model, preference, maximum, expected) => {
    settingsOverride = { [role]: model, modelContextLengths: { 'fixture-model': 4096, [model]: preference } }
    if (maximum) metricStore.metrics = { [model]: { contextLength: maximum, capabilities: ['completion'] } }
    await act(async () => {
      chat.toggleDocSelection('a')
      chat.setInput(query)
    })
    getIngestedDocument.mockResolvedValueOnce({ ...docA, extractedMarkdown: 'Context details '.repeat(1000) })
    await act(async () => chat.handleSendMessage())
    expect(generateOllamaStream).toHaveBeenCalledOnce()
    const request = generateOllamaStream.mock.calls[0][0]
    expect(request).toMatchObject({ model, options: { num_ctx: expected } })
    expect(request.prompt.length).toBeLessThanOrEqual(resolvePromptCharBudget(expected))
  })

  it('keeps the routed window fixed while retrieval waits and settings change', async () => {
    settingsOverride = { medicalModel: 'medical-fixture', modelContextLengths: { 'fixture-model': 4096, 'medical-fixture': 2048 } }
    const search = deferred<VectorSearchResult[]>()
    searchVectorDb.mockReturnValueOnce(search.promise)
    await act(async () => {
      chat.toggleDocSelection('a')
      chat.setInput('Antibiotic therapy for pneumonia')
    })
    let completion!: Promise<void>
    await act(async () => {
      completion = chat.handleSendMessage()
    })
    settingsOverride = { medicalModel: 'other-model', modelContextLengths: { 'medical-fixture': 8192 } }
    await act(async () => chat.setInput('Next question'))
    await act(async () => {
      search.resolve([])
      await completion
    })
    expect(generateOllamaStream.mock.calls[0][0]).toMatchObject({ model: 'medical-fixture', options: { num_ctx: 2048 } })
  })

  it('bounds a saturated retrieved prompt at a 2048-token preference and keeps source cards tied to included passages', async () => {
    settingsOverride = { modelContextLengths: { 'fixture-model': 2048 } }
    getIngestedDocument.mockResolvedValueOnce({ ...docA, extractedMarkdown: 'Document details 😀 '.repeat(1000) })
    searchVectorDb.mockResolvedValueOnce([{ chunk_id: 'a_chunk_0', doc_id: 'a', doc_name: 'a.md', text: 'Retrieved details 😀 '.repeat(1000), score: 0.2 }])
    await send()
    expect(generateOllamaStream).toHaveBeenCalledOnce()
    const prompt = generateOllamaStream.mock.calls[0][0].prompt
    expect(prompt.length).toBeLessThanOrEqual(resolvePromptCharBudget(2048))
    expect(prompt).toContain('User: Find the delivery deadline in these documents')
    for (const source of chat.messages.at(-1)?.sources ?? []) expect(prompt).toContain(`[${source.referenceId}:`)
    expect(prompt).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })

  it('rejects an oversized question before retrieval or model dispatch', async () => {
    await act(async () => chat.setInput('Question '.repeat(2000)))
    await act(async () => chat.handleSendMessage())
    expect(generateOllamaStream).not.toHaveBeenCalled()
    expect(searchVectorDb).not.toHaveBeenCalled()
    expect(chat.messages.at(-1)?.text).toContain('exceed the selected context')
    expect(chat.isGenerating).toBe(false)
  })

  it('does not attach a citation card for a passage with no supplied readable text', async () => {
    searchVectorDb.mockResolvedValueOnce([{ chunk_id: 'empty', doc_id: 'a', doc_name: 'a.md', text: '  ', score: 0.2 }])
    await send()
    expect(generateOllamaStream.mock.calls[0][0].prompt).not.toContain('[S1:')
    expect(chat.messages.at(-1)?.sources ?? []).toEqual([])
  })
  it.each(['rejected', 'missing', 'empty'] as const)('blocks a partially loaded selection when content is %s', async (failure) => {
    if (failure === 'rejected') getIngestedDocument.mockRejectedValueOnce(new Error('load down'))
    if (failure === 'missing') getIngestedDocument.mockResolvedValueOnce(null)
    if (failure === 'empty') getIngestedDocument.mockResolvedValueOnce({ ...docA, extractedMarkdown: '  ' })
    await send(['a', 'b'])
    expect(generateOllamaStream).not.toHaveBeenCalled()
    expect(chat.messages.at(-1)?.text).toContain('1/2 documents loaded')
    expect(chat.messages.at(-1)?.text).toContain(failure === 'empty' ? 'no readable text' : 'content unavailable')
  })
  it('detects a deleted selection even when its Markdown was cached', async () => {
    primeDocumentMarkdown({ ...docA, extractedMarkdown: 'Stale cached text' })
    getIngestedDocuments.mockResolvedValueOnce([docB])
    await send()
    expect(getIngestedDocument).not.toHaveBeenCalled()
    expect(generateOllamaStream).not.toHaveBeenCalled()
    expect(chat.messages.at(-1)?.text).toContain('a.md: no longer indexed (deleted)')
  })
  it('does not turn a missing document list into an ungrounded request', async () => {
    getIngestedDocuments.mockResolvedValueOnce(null)
    await send()
    expect(generateOllamaStream).not.toHaveBeenCalled()
    expect(chat.messages.at(-1)?.text).toContain('document list is unavailable')
  })
  it('uses successfully loaded text when retrieval has no candidates', async () => {
    await send()
    expect(generateOllamaStream).toHaveBeenCalledOnce()
    const prompt = generateOllamaStream.mock.calls[0][0].prompt
    expect(prompt).toContain('[Full Document: a.md]\nReadable a')
    expect(prompt).not.toContain('FULL access')
    expect(chat.messages.at(-1)?.text).toBe('Fixture answer')
  })
  it('retains zero-overlap candidates without using ranking scores as evidence confidence', async () => {
    searchVectorDb.mockResolvedValueOnce([
      { chunk_id: 'candidate', doc_id: 'a', doc_name: 'a.md', text: 'La consegna deve avvenire entro trenta giorni.', score: 0.225 },
    ])
    await send()
    const prompt = generateOllamaStream.mock.calls[0][0].prompt
    expect(prompt).toContain('La consegna deve avvenire entro trenta giorni.')
    expect(prompt).toContain('Retrieved passages are candidates, not verified support.')
    expect(prompt).toContain('If the supplied text does not support the answer, say so.')
    expect(prompt).not.toContain('0.225')
    expect(chat.messages.at(-1)?.sources?.[0].score).toBe(0.225)
  })
  it('labels truncated context in the prompt and the visible saved answer', async () => {
    const text = 'A'.repeat(chat.contextBudget.perDocumentPreviewChars + 100)
    getIngestedDocument.mockResolvedValueOnce({ ...docA, extractedMarkdown: text })
    await send()
    const prompt = generateOllamaStream.mock.calls[0][0].prompt
    expect(prompt).toContain('[Document Excerpt: a.md')
    expect(prompt).not.toContain('[Full Document: a.md]')
    expect(chat.messages.at(-1)?.text).toContain('Partial document context')
    expect(chat.conversations[0].messages.at(-1)?.text).toContain('Partial document context')
    const coverage = chat.messages.at(-1)?.contextCoverage?.items[0]
    expect(coverage).toMatchObject({ kind: 'preview', docId: 'a', status: 'truncated', originalChars: text.length })
    expect(coverage?.text).toBe(text.slice(0, coverage?.text.length))
    expect(prompt).toContain(coverage!.text)
  })
  it('records exactly the supplied multi-document previews and candidates, including budget and scope exclusions', async () => {
    settingsOverride = { modelContextLengths: { 'fixture-model': 2048 } }
    const longPassage = 'Delivery in 21 days 😀. '.repeat(1000)
    getIngestedDocument.mockResolvedValueOnce({ ...docA, extractedMarkdown: 'First document 😀 '.repeat(1000) })
    getIngestedDocument.mockResolvedValueOnce({ ...docB, extractedMarkdown: 'Second document 😀 '.repeat(1000) })
    searchVectorDb.mockResolvedValueOnce([
      { chunk_id: 'a1', doc_id: 'a', doc_name: 'a.md', text: longPassage, score: 1 },
      { chunk_id: 'b1', doc_id: 'b', doc_name: 'b.md', text: 'UNSENT_BUDGET_PASSAGE', score: 0.8 },
      { chunk_id: 'x1', doc_id: 'other', doc_name: 'other.md', text: 'UNSENT_SCOPE_PASSAGE', score: 0.7 },
      { chunk_id: 'a2', doc_id: 'a', doc_name: 'a.md', text: '  ', score: 0.6 },
    ])
    generateOllamaStream.mockImplementationOnce(async (_request, onChunk) => {
      onChunk('Delivery in 21 days [S1].')
      return { success: true }
    })
    await send(['a', 'b'])
    const prompt = generateOllamaStream.mock.calls[0][0].prompt
    const answer = chat.messages.at(-1)!
    const coverage = answer.contextCoverage!
    expect(coverage.retrieval).toBe('completed')
    expect(coverage.items.filter((item) => item.kind === 'preview').map((item) => item.docId)).toEqual(['a', 'b'])
    expect(coverage.items.filter((item) => item.kind === 'passage').map((item) => [item.chunkId, item.status, item.reason])).toEqual([
      ['a1', 'truncated', undefined],
      ['b1', 'excluded', 'budget'],
      ['x1', 'excluded', 'scope'],
      ['a2', 'excluded', 'empty'],
    ])
    for (const item of coverage.items) {
      if (item.status === 'excluded') expect(item.text).toBe('')
      else {
        expect(prompt).toContain(item.text)
        expect(item.text.length).toBeLessThanOrEqual(item.originalChars)
        expect(item.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
      }
    }
    expect(prompt).not.toContain('UNSENT_BUDGET_PASSAGE')
    expect(prompt).not.toContain('UNSENT_SCOPE_PASSAGE')
    expect(answer.sources?.map((source) => [source.referenceId, source.citationState])).toEqual([['S1', 'cited']])
    expect(coverage.items.filter((item) => item.referenceId).map((item) => item.referenceId)).toEqual(['S1'])
    expect(chat.conversations[0].messages.at(-1)?.contextCoverage).toEqual(coverage)
    expect(recovery.state?.conversations[0].messages.at(-1)?.contextCoverage).toEqual(coverage)
  })
  it('records complete previews when retrieval is empty and leaves general chat without document coverage', async () => {
    await send(['a', 'b'])
    expect(chat.messages.at(-1)?.contextCoverage).toEqual({
      retrieval: 'completed',
      items: [
        { kind: 'preview', docId: 'a', docName: 'a.md', originalChars: 10, text: 'Readable a', status: 'included' },
        { kind: 'preview', docId: 'b', docName: 'b.md', originalChars: 10, text: 'Readable b', status: 'included' },
      ],
    })
    await act(async () => chat.handleNewChat())
    await send([])
    expect(chat.messages.at(-1)?.contextCoverage).toBeUndefined()
  })
  it('does not claim context was sent when preparation fails or Stop precedes dispatch', async () => {
    getIngestedDocument.mockRejectedValueOnce(new Error('unavailable'))
    await send()
    expect(chat.messages.at(-1)?.contextCoverage).toBeUndefined()
    const retrieval = deferred<VectorSearchResult[]>()
    searchVectorDb.mockReturnValueOnce(retrieval.promise)
    const { completion } = await start([])
    await act(async () => chat.handleStopGeneration())
    await act(async () => {
      retrieval.resolve([])
      await completion
    })
    expect(generateOllamaStream).not.toHaveBeenCalled()
    expect(chat.messages.at(-1)?.contextCoverage).toBeUndefined()
  })
  it('reports skipped retrieval separately from an empty search when selected previews are supplied', async () => {
    await act(async () => {
      chat.toggleDocSelection('a')
      chat.setInput('Hello')
    })
    await act(async () => chat.handleSendMessage())
    expect(searchVectorDb).not.toHaveBeenCalled()
    expect(generateOllamaStream.mock.calls[0][0].prompt).toContain('[Full Document: a.md]\nReadable a')
    expect(chat.messages.at(-1)?.contextCoverage).toEqual({
      retrieval: 'skipped',
      items: [{ kind: 'preview', docId: 'a', docName: 'a.md', originalChars: 10, text: 'Readable a', status: 'included' }],
    })
  })
  it('persists only completed, supplied citations and reports unknown references', async () => {
    searchVectorDb.mockResolvedValueOnce([
      { chunk_id: 'a_chunk_0', doc_id: 'a', doc_name: 'a.md', text: 'Delivery in 21 days.', score: 0.2 },
      { chunk_id: 'a_chunk_1', doc_id: 'a', doc_name: 'a.md', text: 'Another unrelated passage.', score: 0.9 },
      { chunk_id: 'wrong_chunk_0', doc_id: 'not-selected', doc_name: 'a.md', text: 'Not selected', score: 1 },
    ])
    generateOllamaStream.mockImplementationOnce(async (_request, onChunk) => {
      onChunk('Delivery in 21 days [S1]. Unknown claim [S99].')
      return { success: true }
    })
    await send()
    const answer = chat.messages.at(-1)
    expect(answer?.sources?.map((source) => source.citationState)).toEqual(['cited', 'candidate'])
    expect(answer?.invalidSourceReferences).toEqual(['S99'])
    expect(generateOllamaStream.mock.calls[0][0].prompt).not.toContain('Not selected')
    expect(chat.conversations[0].messages.at(-1)).toEqual(answer)
  })
  it('preserves a missing selection on conversation reload and blocks its next answer', async () => {
    const original = chat.activeConversationId
    await act(async () => chat.toggleDocSelection('deleted-id'))
    vi.advanceTimersByTime(1)
    await act(async () => chat.handleNewChat())
    await act(async () => chat.loadConversation(original))
    expect(chat.selectedDocIds.has('deleted-id')).toBe(true)
    await act(async () => chat.setInput('Analyze the selected file'))
    await act(async () => chat.handleSendMessage())
    expect(generateOllamaStream).not.toHaveBeenCalled()
    expect(chat.messages.at(-1)?.text).toContain('deleted-id: no longer indexed')
  })

  it('does not start generation when Stop interrupts delayed retrieval', async () => {
    const retrieval = deferred<VectorSearchResult[]>()
    searchVectorDb.mockReturnValueOnce(retrieval.promise)
    const { completion } = await start()
    await act(async () => chat.handleStopGeneration())
    await act(async () => {
      retrieval.resolve([])
      await completion
    })
    expect(generateOllamaStream).not.toHaveBeenCalled()
    expect(getIngestedDocuments).not.toHaveBeenCalled()
    expect(chat.isGenerating).toBe(false)
  })
  it('does not complete preparation in a different conversation', async () => {
    const content = deferred<IngestedDocumentContent | null>()
    getIngestedDocument.mockReturnValueOnce(content.promise)
    const { completion } = await start()
    vi.advanceTimersByTime(1)
    await act(async () => chat.handleNewChat())
    const freshId = chat.activeConversationId
    const freshMessages = chat.messages
    await act(async () => {
      content.resolve({ ...docA, extractedMarkdown: 'Late content' })
      await completion
    })
    expect(generateOllamaStream).not.toHaveBeenCalled()
    expect(chat.activeConversationId).toBe(freshId)
    expect(chat.messages).toEqual(freshMessages)
    expect(chat.conversations.find((item) => item.id === freshId)?.messages).toEqual(freshMessages)
  })
  it('ignores old stream callbacks and cancellation completion while another run is active', async () => {
    const first = deferred<{ success: boolean }>()
    const second = deferred<{ success: boolean }>()
    const cancellation = deferred<{ success: boolean }>()
    let oldChunk!: (chunk: string) => void
    let newChunk!: (chunk: string) => void
    generateOllamaStream.mockImplementationOnce((_request, onChunk) => {
      oldChunk = onChunk
      return first.promise
    })
    generateOllamaStream.mockImplementationOnce((_request, onChunk) => {
      newChunk = onChunk
      return second.promise
    })
    cancelOllamaStream.mockReturnValueOnce(cancellation.promise)
    const oldRun = await start([])
    let stopping!: Promise<void>
    await act(async () => {
      stopping = chat.handleStopGeneration()
    })
    expect(chat.isGenerating).toBe(false)
    vi.advanceTimersByTime(2)
    const newRun = await start([])
    await act(async () => {
      oldChunk('Stale answer')
      first.resolve({ success: true })
      await oldRun.completion
    })
    await act(async () => {
      cancellation.resolve({ success: true })
      await stopping
    })
    expect(chat.isGenerating).toBe(true)
    expect(chat.messages.some((item) => item.text.includes('Stale answer'))).toBe(false)
    await act(async () => {
      newChunk('Current answer')
      second.resolve({ success: true })
      await newRun.completion
    })
    expect(chat.messages.at(-1)?.text).toBe('Current answer')
    expect(chat.conversations[0].messages).toEqual(chat.messages)
  })
  it.each(['metadata', 'content'] as const)('stops during delayed %s loading', async (stage) => {
    const metadata = deferred<IngestedDocument[] | null>()
    const content = deferred<IngestedDocumentContent | null>()
    if (stage === 'metadata') getIngestedDocuments.mockReturnValueOnce(metadata.promise)
    else getIngestedDocument.mockReturnValueOnce(content.promise)
    const { completion } = await start()
    await act(async () => chat.handleStopGeneration())
    await act(async () => {
      if (stage === 'metadata') metadata.resolve([docA])
      else content.resolve({ ...docA, extractedMarkdown: 'Late text' })
      await completion
    })
    expect(generateOllamaStream).not.toHaveBeenCalled()
    expect(chat.messages.at(-1)?.text).toContain('Generation stopped')
    expect(chat.conversations[0].messages).toEqual(chat.messages)
  })
  it('ignores a late retrieval rejection without settling the newer run', async () => {
    const retrieval = deferred<VectorSearchResult[]>()
    const generation = deferred<{ success: boolean }>()
    searchVectorDb.mockReturnValueOnce(retrieval.promise)
    let currentChunk!: (chunk: string) => void
    generateOllamaStream.mockImplementationOnce((_request, onChunk) => {
      currentChunk = onChunk
      return generation.promise
    })
    const oldRun = await start()
    await act(async () => chat.handleStopGeneration())
    const current = await start(['a'])
    await act(async () => {
      retrieval.reject(new Error('Late retrieval failure'))
      await oldRun.completion
    })
    expect(chat.isGenerating).toBe(true)
    expect(chat.messages.some((item) => item.text.includes('Document search failed'))).toBe(false)
    await act(async () => {
      currentChunk('Current answer')
      generation.resolve({ success: true })
      await current.completion
    })
    expect(chat.messages.at(-1)?.text).toBe('Current answer')
  })
  it('cancels the queued run by its preparation identity without running it or cancelling another request', async () => {
    const scheduler = new OllamaGenerationScheduler()
    const gate = deferred<string>()
    const otherCancel = vi.fn()
    const other = scheduler.schedule(
      'other request',
      async (setCancel) => {
        setCancel(otherCancel)
        return gate.promise
      },
      'other-id',
    )
    const queuedExecution = vi.fn(async () => ({ success: true }))
    generateOllamaStream.mockImplementationOnce((request) => scheduler.schedule('chat', queuedExecution, request.operationId).promise)
    cancelOllamaStream.mockImplementationOnce(async () => ({ success: scheduler.cancel(generateOllamaStream.mock.calls[0][0].operationId) }))
    const { completion } = await start([])
    const operationId = generateOllamaStream.mock.calls[0][0].operationId
    expect(chat.messages.at(-1)?.id).toBe(`${operationId}:bot`)
    expect(scheduler.getStatus().queued[0].id).toBe(operationId)
    await act(async () => {
      await chat.handleStopGeneration()
      await completion
    })
    expect(cancelOllamaStream).toHaveBeenCalledWith({ operationId })
    expect(queuedExecution).not.toHaveBeenCalled()
    expect(otherCancel).not.toHaveBeenCalled()
    expect(scheduler.getStatus().active?.id).toBe('other-id')
    await act(async () => {
      gate.resolve('done')
      await other.promise
    })
    expect(chat.isGenerating).toBe(false)
    expect(chat.messages.at(-1)?.text).toContain('Generation stopped')
  })
  it.each(['switch', 'delete'] as const)('isolates delayed preparation after conversation %s', async (action) => {
    const original = chat.activeConversationId
    await act(async () => chat.handleNewChat())
    const other = chat.activeConversationId
    await act(async () => chat.loadConversation(original))
    const content = deferred<IngestedDocumentContent | null>()
    getIngestedDocument.mockReturnValueOnce(content.promise)
    const { completion } = await start()
    await act(async () => {
      if (action === 'switch') chat.loadConversation(other)
      else chat.deleteConversation(original)
    })
    const remainingMessages = chat.messages
    await act(async () => {
      content.resolve({ ...docA, extractedMarkdown: 'Stale content' })
      await completion
    })
    expect(generateOllamaStream).not.toHaveBeenCalled()
    expect(chat.activeConversationId).toBe(other)
    expect(chat.messages).toEqual(remainingMessages)
    expect(chat.conversations.find((item) => item.id === other)?.messages).toEqual(remainingMessages)
    if (action === 'delete') expect(chat.conversations.some((item) => item.id === original)).toBe(false)
  })
  it('does not restart retrieval when an unmounted chat completes preparation', async () => {
    const retrieval = deferred<VectorSearchResult[]>()
    searchVectorDb.mockReturnValueOnce(retrieval.promise)
    const { completion } = await start()
    await act(async () => root.unmount())
    await act(async () => {
      retrieval.resolve([])
      await completion
    })
    expect(generateOllamaStream).not.toHaveBeenCalled()
    expect(getIngestedDocuments).not.toHaveBeenCalled()
  })
  it('does not dispatch a cancelled run after its delayed Main question checkpoint completes', async () => {
    const checkpoint = deferred<import('../../shared/domain/chatHistory').ChatHistoryRecovery>()
    const write = vi.spyOn(window.electronAPI!, 'saveChatRecovery').mockImplementationOnce(() => checkpoint.promise)
    const { completion } = await start([])
    await act(async () => {
      await chat.handleStopGeneration()
    })
    await act(async () => {
      checkpoint.resolve(write.mock.calls[0][0])
      await completion
    })
    expect(generateOllamaStream).not.toHaveBeenCalled()
    expect(chat.messages.at(-1)?.text).toContain('Generation stopped')
  })

  it('rejects duplicate sends synchronously before React rerenders', async () => {
    const retrieval = deferred<VectorSearchResult[]>()
    searchVectorDb.mockReturnValueOnce(retrieval.promise)
    await act(async () => {
      chat.toggleDocSelection('a')
      chat.setInput('Find deadline')
    })
    let first!: Promise<void>
    await act(async () => {
      first = chat.handleSendMessage()
      await chat.handleSendMessage()
    })
    expect(searchVectorDb).toHaveBeenCalledOnce()
    await act(async () => {
      retrieval.resolve([])
      await first
    })
    expect(generateOllamaStream).toHaveBeenCalledOnce()
  })
  it('checkpoints an active turn during a continuous stream and restores it as incomplete', async () => {
    const generation = deferred<{ success: boolean }>()
    let chunk!: (text: string) => void
    generateOllamaStream.mockImplementationOnce((_request, onChunk) => {
      chunk = onChunk
      return generation.promise
    })
    const { completion } = await start([])
    expect(JSON.parse(localStorage.getItem('onlyrag_chat_conversations')!)[0].messages.at(-2).sender).toBe('user')
    for (let i = 0; i < 12; i++) {
      await act(async () => {
        chunk('partial ')
        vi.advanceTimersByTime(50)
      })
    }
    const checkpoint = JSON.parse(localStorage.getItem('onlyrag_chat_conversations')!)[0].messages.at(-1)
    expect(checkpoint.text).toContain('partial')
    expect(checkpoint.isStreaming).toBe(true)
    await act(async () => root.unmount())
    localStorage.clear() // Chromium's latest local copy may not survive process interruption.
    root = createRoot(document.createElement('div'))
    await act(async () =>
      root.render(
        <I18nProvider initialLanguage="en">
          <Harness />
        </I18nProvider>,
      ),
    )
    expect(chat.messages.at(-1)?.interrupted).toBe(true)
    expect(chat.messages.at(-1)?.isStreaming).toBe(false)
    expect(chat.messages.at(-1)?.text).toBe('partial '.repeat(12))
    await act(async () => {
      generation.resolve({ success: true })
      await completion
    })
    expect(chat.messages.at(-1)?.interrupted).toBe(true)
  })

  it('flushes unpainted tokens on close and refuses a failed history write until retry', async () => {
    const generation = deferred<{ success: boolean }>()
    let chunk!: (text: string) => void
    generateOllamaStream.mockImplementationOnce((_request, onChunk) => {
      chunk = onChunk
      return generation.promise
    })
    const { completion } = await start([])
    const flush = (window as unknown as { __onlyragFlushChat: () => Promise<boolean> }).__onlyragFlushChat
    const failure = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('full')
    })
    await act(async () => {
      chunk('not yet painted')
      expect(await flush()).toBe(false)
    })
    expect(chat.storageError).toBe('save')
    failure.mockRestore()
    await act(async () => {
      expect(await flush()).toBe(true)
    })
    expect(JSON.parse(localStorage.getItem('onlyrag_chat_conversations')!)[0].messages.at(-1).text).toBe('not yet painted')
    await act(async () => {
      generation.resolve({ success: true })
      await completion
    })
    expect(chat.messages.at(-1)?.isStreaming).toBe(false)
  })

  it('preserves unflushed text at Stop and persists only the stopped response', async () => {
    searchVectorDb.mockResolvedValueOnce([{ chunk_id: 'a_chunk_0', doc_id: 'a', doc_name: 'a.md', text: 'Payment in 21 days.', score: 0.2 }])
    const generation = deferred<{ success: boolean }>()
    let chunk!: (text: string) => void
    generateOllamaStream.mockImplementationOnce((_request, onChunk) => {
      chunk = onChunk
      return generation.promise
    })
    const { completion } = await start(['a'])
    expect(chat.messages.at(-1)?.sources?.[0].citationState).toBe('candidate')
    await act(async () => {
      chunk('Unflushed answer [S1]')
      await chat.handleStopGeneration()
    })
    expect(chat.messages.at(-1)?.text).toContain('Unflushed answer')
    expect(chat.messages.at(-1)?.text).toContain('Generation stopped')
    expect(chat.messages.at(-1)?.sources?.[0].citationState).toBe('candidate')
    const stopped = chat.messages
    await act(async () => {
      chunk('Stale tokens')
      generation.resolve({ success: true })
      await completion
      vi.advanceTimersByTime(500)
    })
    expect(chat.messages).toEqual(stopped)
    expect(chat.conversations[0].messages).toEqual(stopped)
    expect(JSON.parse(localStorage.getItem('onlyrag_chat_conversations')!)[0].messages).toEqual(stopped)
  })
})
