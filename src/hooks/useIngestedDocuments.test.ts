import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  notifyDocumentsChanged,
  notifyTabChanged,
  DOCUMENTS_CHANGED_EVENT,
  TAB_CHANGED_EVENT,
} from './useIngestedDocuments'

describe('useIngestedDocuments event synchronization', () => {
  let dispatchEventSpy: any

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
