import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocumentDrafts } from './useDocumentDrafts'
import type { DocumentDraftSnapshot } from '../../shared/domain/documentDraft'

describe('document draft persistence lifecycle', () => {
  let root: Root
  let drafts: ReturnType<typeof useDocumentDrafts>
  let stored: DocumentDraftSnapshot
  const load = vi.fn(async () => structuredClone(stored))
  const save = vi.fn(async (snapshot: DocumentDraftSnapshot) => {
    stored = structuredClone(snapshot)
    return stored
  })
  const a = { content: 'Draft A', ingestedAt: 't1', markdown: 'Original A' }
  const mount = async (strict = false) => {
    root = createRoot(document.createElement('div'))
    function Harness() {
      drafts = useDocumentDrafts()
      return null
    }
    await act(async () =>
      root.render(
        strict ? (
          <StrictMode>
            <Harness />
          </StrictMode>
        ) : (
          <Harness />
        ),
      ),
    )
  }
  beforeEach(async () => {
    vi.useFakeTimers()
    stored = { revision: 'missing', drafts: [] }
    vi.clearAllMocks()
    window.electronAPI = { loadDocumentDrafts: load, saveDocumentDrafts: save } as unknown as NonNullable<typeof window.electronAPI>
    await mount()
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    vi.restoreAllMocks()
    vi.useRealTimers()
  })
  const close = () => (window as unknown as { __onlyragFlushDocumentDrafts: () => Promise<boolean> }).__onlyragFlushDocumentDrafts()

  it('flushes before debounce and restores multiple drafts after remount without rebasing', async () => {
    await act(async () => {
      drafts.changeDraft('a', a)
      drafts.changeDraft('b', { ...a, ingestedAt: 't0' })
      expect(await close()).toBe(true)
    })
    expect(stored.drafts).toHaveLength(2)
    await act(async () => root.unmount())
    await mount()
    expect(drafts.draftsRef.current.get('a')).toEqual(a)
    expect(drafts.draftsRef.current.get('b')?.ingestedAt).toBe('t0')
  })

  it('refuses close on write failure, retains memory, retries and persists explicit removal', async () => {
    save.mockRejectedValueOnce(new Error('disk full'))
    await act(async () => {
      drafts.changeDraft('a', a)
      expect(await close()).toBe(false)
    })
    expect(drafts.error).toBe('disk full')
    expect(drafts.draftsRef.current.get('a')).toEqual(a)
    expect(stored.drafts).toEqual([])
    await act(async () => {
      await drafts.retry()
    })
    expect(drafts.error).toBeNull()
    expect(stored.drafts).toEqual([{ docId: 'a', ...a }])
    await act(async () => {
      drafts.changeDraft('a', null)
      await close()
    })
    expect(stored.drafts).toEqual([])
  })

  it('continues a flush when a newer edit arrives before acknowledgement', async () => {
    let finish!: (snapshot: DocumentDraftSnapshot) => void
    save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    let closing!: Promise<boolean>
    await act(async () => {
      drafts.changeDraft('a', a)
      closing = close()
    })
    await act(async () => {
      drafts.changeDraft('a', { ...a, content: 'Newer text' })
      finish({ revision: 'r1', drafts: [{ docId: 'a', ...a }] })
      expect(await closing).toBe(true)
    })
    expect(stored.drafts[0].content).toBe('Newer text')
    expect(save.mock.calls.at(-1)?.[0].revision).toBe('r1')
  })

  it('blocks edits after bootstrap failure and retries without overwriting unread archives', async () => {
    await act(async () => root.unmount())
    load.mockRejectedValueOnce(new Error('unreadable archive'))
    await mount()
    expect(drafts.ready).toBe(false)
    await act(async () => {
      drafts.changeDraft('a', a)
      await close()
    })
    expect(save).not.toHaveBeenCalled()
    expect(drafts.error).toBe('unreadable archive')
    await act(async () => {
      await drafts.retry()
    })
    expect(drafts.ready).toBe(true)
  })

  it('ignores an older StrictMode bootstrap that returns after the active load and newer typing', async () => {
    await act(async () => root.unmount())
    let first!: (snapshot: DocumentDraftSnapshot) => void
    load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          first = resolve
        }),
    )
    await mount(true)
    await act(async () => {
      drafts.changeDraft('a', a)
      first({ revision: 'old', drafts: [{ docId: 'a', ...a, content: 'Stale disk draft' }] })
    })
    expect(drafts.draftsRef.current.get('a')?.content).toBe('Draft A')
    await act(async () => {
      expect(await close()).toBe(true)
    })
    expect(stored.drafts[0].content).toBe('Draft A')
  })
})
