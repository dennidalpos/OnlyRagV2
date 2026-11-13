import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitStatus } from './useGitStatus'

interface GitResult {
  isGitRepo: boolean
  statusLines: string[]
  diffText: string
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const result = (name: string): GitResult => ({ isGitRepo: true, statusLines: [` M ${name}.ts`], diffText: `diff of ${name}` })

describe('useGitStatus ownership of asynchronous reads', () => {
  let container: HTMLDivElement
  let root: Root
  let state: ReturnType<typeof useGitStatus>
  const api = { getGitStatusAndDiff: vi.fn(), initGitRepository: vi.fn() }

  function Harness({ workspace }: { workspace: string | null }) {
    state = useGitStatus(workspace)
    return (
      <div>
        <p id="status">{state.gitStatusLines.join('|')}</p>
        <p id="diff">{state.gitDiffText}</p>
        <p id="repo">{String(state.isGitRepo)}</p>
        <p id="loading">{String(state.isFetchingGit)}</p>
        <p id="label">{String(state.gitDataWorkspace)}</p>
      </div>
    )
  }
  const text = (id: string) => container.querySelector(`#${id}`)!.textContent
  const render = (workspace: string | null) => act(async () => root.render(<Harness workspace={workspace} />))
  /** Starts an operation inside act and returns its still-pending promise without waiting for it. */
  const begin = async (action: () => Promise<void>): Promise<{ pending: Promise<void> }> => {
    let pending!: Promise<void>
    await act(async () => {
      pending = action()
    })
    return { pending }
  }
  /** Runs an operation that settles by itself to completion inside act. */
  const run = (action: () => Promise<void>) => act(async () => action())

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.clearAllMocks()
    Object.assign(window, { electronAPI: api })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  it('does not let a late response of workspace A replace the diff shown for workspace B', async () => {
    const lateA = deferred<GitResult>()
    api.getGitStatusAndDiff.mockImplementation(({ workspaceRoot }: { workspaceRoot?: string }) =>
      workspaceRoot === 'A' ? lateA.promise : Promise.resolve(result('B')),
    )

    await render('A')
    const readA = await begin(() => state.fetchGitStatusAndDiff())
    await render('B')
    await run(() => state.fetchGitStatusAndDiff())
    expect(text('diff')).toBe('diff of B')
    expect(text('label')).toBe('B')

    await act(async () => lateA.resolve(result('A')))
    await readA.pending
    expect(text('diff')).toBe('diff of B')
    expect(text('status')).toBe(' M B.ts')
    expect(text('label')).toBe('B')
    expect(text('loading')).toBe('false')
  })

  it('clears the previous workspace data as soon as the workspace changes', async () => {
    api.getGitStatusAndDiff.mockResolvedValue(result('A'))
    await render('A')
    await run(() => state.fetchGitStatusAndDiff())
    expect(text('diff')).toBe('diff of A')

    await render('B')
    expect(text('diff')).toBe('')
    expect(text('status')).toBe('')
    expect(text('label')).toBe('null')
  })

  it('ignores a late failure of the previous workspace', async () => {
    const lateFailure = deferred<GitResult>()
    api.getGitStatusAndDiff.mockImplementation(({ workspaceRoot }: { workspaceRoot?: string }) =>
      workspaceRoot === 'A' ? lateFailure.promise : Promise.resolve(result('B')),
    )

    await render('A')
    const readA = await begin(() => state.fetchGitStatusAndDiff())
    await render('B')
    await run(() => state.fetchGitStatusAndDiff())
    await act(async () => lateFailure.reject(new Error('A broke')))
    await readA.pending
    expect(text('diff')).toBe('diff of B')
    expect(text('repo')).toBe('true')
  })

  it('keeps only the latest of concurrent refreshes in the same workspace', async () => {
    const slow = deferred<GitResult>()
    const fast = deferred<GitResult>()
    api.getGitStatusAndDiff.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise)

    await render('A')
    const first = await begin(() => state.fetchGitStatusAndDiff())
    const second = await begin(() => state.fetchGitStatusAndDiff())
    await act(async () => fast.resolve({ ...result('A'), diffText: 'newest' }))
    await second.pending
    expect(text('diff')).toBe('newest')
    expect(text('loading')).toBe('false')

    await act(async () => slow.resolve({ ...result('A'), diffText: 'older' }))
    await first.pending
    expect(text('diff')).toBe('newest')
    expect(text('loading')).toBe('false')
  })

  it('does not let a stale same-workspace failure change the current data or loading state', async () => {
    const stale = deferred<GitResult>()
    api.getGitStatusAndDiff.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(result('current'))
    await render('A')
    const first = await begin(() => state.fetchGitStatusAndDiff())
    await run(() => state.fetchGitStatusAndDiff())
    expect(text('loading')).toBe('false')
    await act(async () => stale.reject(new Error('stale failure')))
    await first.pending
    expect(text('diff')).toBe('diff of current')
    expect(text('loading')).toBe('false')
  })

  it('refreshes after initGit, reports a failed init and succeeds on retry', async () => {
    api.initGitRepository.mockResolvedValueOnce({ success: false, message: 'init denied' }).mockResolvedValueOnce({ success: true })
    api.getGitStatusAndDiff.mockResolvedValue(result('A'))
    await render('A')

    await run(() => state.initGit())
    expect(text('diff')).toContain('init denied')
    expect(text('loading')).toBe('false')
    expect(api.getGitStatusAndDiff).not.toHaveBeenCalled()

    await run(() => state.initGit())
    expect(text('diff')).toBe('diff of A')
    expect(text('label')).toBe('A')
    expect(api.initGitRepository).toHaveBeenCalledTimes(2)
  })

  it('drops the refresh that follows initGit when the workspace changed meanwhile', async () => {
    const init = deferred<{ success: boolean }>()
    api.initGitRepository.mockReturnValue(init.promise)
    api.getGitStatusAndDiff.mockImplementation(({ workspaceRoot }: { workspaceRoot?: string }) => Promise.resolve(result(workspaceRoot || 'none')))

    await render('A')
    const started = await begin(() => state.initGit())
    await render('B')
    await act(async () => init.resolve({ success: true }))
    await started.pending
    expect(api.getGitStatusAndDiff).not.toHaveBeenCalled()
    expect(text('diff')).toBe('')
    expect(text('loading')).toBe('false')
  })
})
