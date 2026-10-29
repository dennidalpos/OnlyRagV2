// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { usePromptHistorySearch } from './usePromptHistorySearch'

describe('prompt history search availability and ownership', () => {
  it.each(['missing', 'rejected', 'malformed', 'empty', 'retry', 'reset', 'newer', 'unmount'] as const)(
    'keeps truthful owned search state: %s',
    async (scenario) => {
      const releases: ((value: unknown) => void)[] = []
      const searchPort = vi.fn().mockImplementation(() => new Promise((resolve) => releases.push(resolve)))
      if (scenario === 'rejected' || scenario === 'retry') searchPort.mockRejectedValueOnce(new Error('Sidecar unavailable'))
      ;(window as unknown as { electronAPI: unknown }).electronAPI = scenario === 'missing' ? {} : { searchPromptHistory: searchPort }
      let state!: ReturnType<typeof usePromptHistorySearch>
      function Harness() {
        state = usePromptHistorySearch()
        return null
      }
      const root = createRoot(document.createElement('div'))
      let unmounted = false
      try {
        await act(async () => root.render(<Harness />))
        let pending!: Promise<void>
        act(() => {
          pending = state.search('first')
        })
        if (['missing', 'rejected', 'retry'].includes(scenario)) {
          await act(async () => pending)
          expect(state.error).toBeTruthy()
          expect(state.hasSearched).toBe(false)
          if (scenario !== 'retry') return
          act(() => {
            pending = state.search('retry')
          })
        }
        if (scenario === 'reset') act(() => state.reset())
        if (scenario === 'newer')
          act(() => {
            void state.search('second')
          })
        if (scenario === 'unmount') {
          await act(async () => root.unmount())
          unmounted = true
        }
        await act(async () => {
          releases[0](scenario === 'malformed' ? null : [])
          await pending
        })
        if (scenario === 'malformed') expect(state.error).toBeTruthy()
        else if (scenario === 'reset' || scenario === 'newer' || scenario === 'unmount') expect(state.hasSearched).toBe(false)
        else {
          expect(state.error).toBeNull()
          expect(state.hasSearched).toBe(true)
          expect(state.results).toEqual([])
        }
        if (scenario === 'newer') {
          expect(state.isSearching).toBe(true)
          await act(async () => releases[1]([]))
          expect(state.isSearching).toBe(false)
          expect(state.hasSearched).toBe(true)
        }
      } finally {
        if (!unmounted) await act(async () => root.unmount())
      }
    },
  )
})
