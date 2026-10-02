import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IngestedDocument, IngestedDocumentContent, VectorSearchResult } from '../types'
import { I18nProvider } from '../i18n'
import { DEFAULT_APP_SETTINGS } from '../../shared/domain/settings/appSettingsDefaults'
import { primeDocumentMarkdown, clearDocumentMarkdownCache } from '../services/documentMarkdown'
import { OllamaGenerationScheduler } from '../../electron/core/infrastructure/http/ollamaGenerationScheduler'

const documentStore: { documents: IngestedDocument[] } = { documents: [] }
vi.mock('./useIngestedDocuments', () => ({
  useIngestedDocuments: () => ({ documents: documentStore.documents, refetchDocuments: vi.fn() }),
}))
vi.mock('./useOllamaModelMetrics', () => ({ useOllamaModelMetrics: () => ({ metrics: {} }) }))

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
    chat = useChatEngine({ ...DEFAULT_APP_SETTINGS, defaultModel: 'fixture-model' }, null)
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
    documentStore.documents = [docA, docB]
    localStorage.clear()
    clearDocumentMarkdownCache()
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      getIngestedDocuments,
      getIngestedDocument,
      searchVectorDb,
      generateOllamaStream,
      cancelOllamaStream,
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
