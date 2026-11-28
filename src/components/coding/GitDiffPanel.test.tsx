import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { GitDiffPanel } from './GitDiffPanel'
import { useGitStatus } from '../../hooks/useGitStatus'

it('renders a Git initialization failure next to the retry action', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  const retry = vi.fn()
  try {
    await act(async () =>
      root.render(
        <GitDiffPanel
          gitStatusLines={[]}
          gitDiffText="Git error: init denied"
          isFetchingGit={false}
          isGitRepo={false}
          workspaceLabel="C:/A"
          onRefreshGit={() => {}}
          onInitGit={retry}
        />,
      ),
    )
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Git error: init denied')
    const initButton = [...container.querySelectorAll('button')].find((button) => /init|inizial/i.test(button.textContent || ''))
    expect(initButton).toBeDefined()
    await act(async () => initButton!.click())
    expect(retry).toHaveBeenCalledOnce()
  } finally {
    await act(async () => root.unmount())
  }
})

it('labels the displayed Git data with its own workspace through an out-of-order workspace switch', async () => {
  const previous = window.electronAPI
  let finishA!: (value: { isGitRepo: boolean; statusLines: string[]; diffText: string }) => void
  const delayedA = new Promise<{ isGitRepo: boolean; statusLines: string[]; diffText: string }>((resolve) => {
    finishA = resolve
  })
  const result = (name: string) => ({ isGitRepo: true, statusLines: [` M ${name}.ts`], diffText: '' })
  const read = vi
    .fn()
    .mockImplementation(({ workspaceRoot }: { workspaceRoot: string }) => (workspaceRoot === 'C:/A' ? delayedA : Promise.resolve(result('B'))))
  window.electronAPI = { getGitStatusAndDiff: read } as unknown as typeof window.electronAPI
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let state!: ReturnType<typeof useGitStatus>
  function Harness({ workspace }: { workspace: string }) {
    state = useGitStatus(workspace)
    return (
      <GitDiffPanel
        gitStatusLines={state.gitStatusLines}
        gitDiffText={state.gitDiffText}
        isFetchingGit={state.isFetchingGit}
        isGitRepo={state.isGitRepo}
        workspaceLabel={state.gitDataWorkspace}
        onRefreshGit={() => void state.fetchGitStatusAndDiff()}
      />
    )
  }
  try {
    await act(async () => root.render(<Harness workspace="C:/A" />))
    let pending!: Promise<void>
    await act(async () => {
      pending = state.fetchGitStatusAndDiff()
    })
    await act(async () => root.render(<Harness workspace="C:/B" />))
    expect(container.querySelector('[title="C:/A"]')).toBeNull()
    expect(container.querySelector('[title="C:/B"]')).toBeNull()
    await act(async () => state.fetchGitStatusAndDiff())
    expect(container.querySelector('[title="C:/B"]')?.textContent).toBe('B')
    expect(container.textContent).toContain('B.ts')
    await act(async () => {
      finishA(result('A'))
      await pending
    })
    expect(container.querySelector('[title="C:/B"]')?.textContent).toBe('B')
    expect(container.querySelector('[title="C:/A"]')).toBeNull()
    expect(container.textContent).not.toContain('A.ts')
  } finally {
    await act(async () => root.unmount())
    container.remove()
    window.electronAPI = previous
  }
})
