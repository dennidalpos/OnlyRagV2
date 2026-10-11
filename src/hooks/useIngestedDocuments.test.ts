import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { notifyDocumentsChanged, notifyTabChanged, DOCUMENTS_CHANGED_EVENT, TAB_CHANGED_EVENT, useIngestedDocuments } from './useIngestedDocuments'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('useIngestedDocuments event synchronization', () => {
  let dispatchEventSpy: MockInstance<Window['dispatchEvent']>

  beforeEach(() => {
    dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('notifyDocumentsChanged dispatches DOCUMENTS_CHANGED_EVENT', () => {
    notifyDocumentsChanged()
    expect(dispatchEventSpy).toHaveBeenCalled()
    const lastCallArg = dispatchEventSpy.mock.calls[0][0]
    expect(lastCallArg.type).toBe(DOCUMENTS_CHANGED_EVENT)
  })

  it('notifyTabChanged dispatches TAB_CHANGED_EVENT with tab detail', () => {
    notifyTabChanged('chat')
    expect(dispatchEventSpy).toHaveBeenCalled()
    const lastCallArg = dispatchEventSpy.mock.calls[0][0] as CustomEvent
    expect(lastCallArg.type).toBe(TAB_CHANGED_EVENT)
    expect(lastCallArg.detail).toEqual({ tab: 'chat' })
  })

  it('listener receives document change and tab change events', () => {
    const docChangeHandler = vi.fn()
    const tabChangeHandler = vi.fn()

    window.addEventListener(DOCUMENTS_CHANGED_EVENT, docChangeHandler)
    window.addEventListener(TAB_CHANGED_EVENT, tabChangeHandler)

    notifyDocumentsChanged()
    expect(docChangeHandler).toHaveBeenCalledTimes(1)

    notifyTabChanged('translation')
    expect(tabChangeHandler).toHaveBeenCalledTimes(1)

    window.removeEventListener(DOCUMENTS_CHANGED_EVENT, docChangeHandler)
    window.removeEventListener(TAB_CHANGED_EVENT, tabChangeHandler)
  })
})

describe('useIngestedDocuments refresh ownership', () => {
  let root: Root
  let documents: ReturnType<typeof useIngestedDocuments>
  let getIngestedDocuments: ReturnType<typeof vi.fn>

  function Harness() {
    documents = useIngestedDocuments()
    return null
  }

  beforeEach(async () => {
    getIngestedDocuments = vi.fn().mockResolvedValue([])
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { getIngestedDocuments }
    root = createRoot(document.createElement('div'))
    await act(async () => root.render(createElement(Harness)))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
  })

  it('coalesces one refresh when a document mutation arrives during a list request', async () => {
    const first = deferred<[]>()
    getIngestedDocuments.mockReturnValueOnce(first.promise)

    await act(async () => void documents.refetchDocuments())
    await act(async () => notifyDocumentsChanged())
    await act(async () => first.resolve([]))
    await act(async () => {})

    expect(getIngestedDocuments).toHaveBeenCalledTimes(3)
  })
})
