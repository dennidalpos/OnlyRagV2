import { act, type SetStateAction } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useGitStatus } from './useGitStatus'

// Observe the React state boundary: React silently drops post-unmount writes, so a console spy cannot detect them.
const observer = vi.hoisted(() => ({ unmounted: false, writes: vi.fn() }))
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return {
    ...react,
    useState: function useObservedState<T>(initial: T | (() => T)) {
      const [value, setValue] = react.useState(initial)
      return [
        value,
        (next: SetStateAction<T>) => {
          if (observer.unmounted) observer.writes()
          setValue(next)
        },
      ] as const
    },
  }
})

it.each(['success', 'failure', 'init'] as const)('does not dispatch React state writes after unmount on late %s', async (outcome) => {
  const previous = window.electronAPI
  let resolve!: (value: unknown) => void
  let reject!: (error: Error) => void
  const delayed = new Promise((done, fail) => {
    resolve = done
    reject = fail
  })
  const reads = vi.fn().mockReturnValue(delayed)
  window.electronAPI = { getGitStatusAndDiff: reads, initGitRepository: () => delayed } as unknown as typeof window.electronAPI
  const container = document.createElement('div')
  const root = createRoot(container)
  let state!: ReturnType<typeof useGitStatus>
  function Harness() {
    state = useGitStatus('A')
    return null
  }
  observer.unmounted = false
  observer.writes.mockClear()
  let unmounted = false
  try {
    await act(async () => root.render(<Harness />))
    let pending!: Promise<void>
    await act(async () => {
      pending = outcome === 'init' ? state.initGit() : state.fetchGitStatusAndDiff()
    })
    await act(async () => root.unmount())
    unmounted = true
    observer.unmounted = true
    await act(async () => {
      if (outcome === 'failure') reject(new Error('late failure'))
      else resolve({ isGitRepo: true, statusLines: [' M A.ts'], diffText: 'late A' })
      await pending
    })
    expect(observer.writes).not.toHaveBeenCalled()
    expect(reads).toHaveBeenCalledTimes(outcome === 'init' ? 0 : 1)
  } finally {
    observer.unmounted = false
    if (!unmounted) await act(async () => root.unmount())
    window.electronAPI = previous
  }
})
