import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtifactPreviewPanel } from './ArtifactPreviewPanel'
import type { ArtifactRecord } from '../../types'
import { I18nProvider } from '../../i18n'

const record: ArtifactRecord = {
  id: 'a1',
  workspacePath: 'C:\\ws',
  name: 'Recovered',
  kind: 'html',
  content: '<p>ok</p>',
  createdAt: '2026-11-07T00:00:00.000Z',
  updatedAt: '2026-11-07T00:00:00.000Z',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('ArtifactPreviewPanel selection and storage', () => {
  let container: HTMLDivElement
  let root: Root
  const api = { listArtifacts: vi.fn(), saveArtifact: vi.fn(), deleteArtifact: vi.fn() }
  const previous = window.electronAPI
  const render = (workspacePath = record.workspacePath) =>
    act(async () =>
      root.render(
        <I18nProvider initialLanguage="en">
          <ArtifactPreviewPanel workspacePath={workspacePath} />
        </I18nProvider>,
      ),
    )
  const button = (name: string) =>
    [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === name || item.getAttribute('aria-label') === name)!
  const click = (name: string) => act(async () => button(name).click())
  const content = () => container.querySelector('textarea')!
  const preview = () => container.querySelector('iframe')!.getAttribute('srcdoc')
  const edit = (value: string) =>
    act(async () => {
      const field = content()
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.resetAllMocks()
    Object.assign(window, { electronAPI: api })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    window.electronAPI = previous
  })

  it('shows the load error instead of an empty list and recovers on retry', async () => {
    api.listArtifacts.mockRejectedValueOnce(new Error('Artifact record is not valid JSON')).mockResolvedValue([record])
    await render()

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('not valid JSON')
    expect(api.saveArtifact).not.toHaveBeenCalled()

    const retry = container.querySelector('[role="alert"] button') as HTMLButtonElement
    await act(async () => retry.click())
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('Recovered')
    expect(api.listArtifacts.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('retries the write with the same unsaved draft and clears its error on success', async () => {
    api.listArtifacts.mockResolvedValue([record])
    api.saveArtifact.mockRejectedValueOnce(new Error('write denied')).mockResolvedValue({ ...record, id: 'new', content: '<p>kept</p>' })
    await render()
    await click('New')
    await edit('<p>kept</p>')
    await click('Save')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('write denied')
    expect(content().value).toBe('<p>kept</p>')
    await click('Retry')
    expect(api.saveArtifact).toHaveBeenCalledTimes(2)
    expect(api.saveArtifact.mock.calls[1]).toEqual(api.saveArtifact.mock.calls[0])
    expect(api.saveArtifact.mock.calls[1][0].input.id).toBeUndefined()
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('keeps a distinct new draft through a pending refresh and saves with a new ID', async () => {
    const refresh = deferred<ArtifactRecord[]>()
    api.listArtifacts.mockResolvedValueOnce([record]).mockReturnValueOnce(refresh.promise)
    api.saveArtifact.mockResolvedValue({ ...record, id: 'new', name: 'Created', content: '<h1>new</h1>' })
    await render()
    expect(content().value).toBe(record.content)
    await edit('<p>editor update</p>')
    expect(preview()).toBe('<p>editor update</p>')
    await click('Refresh')
    await click('New')
    await edit('<h1>new</h1>')
    await act(async () => refresh.resolve([record]))
    expect(preview()).toBe('<h1>new</h1>')
    expect(container.querySelector('[aria-pressed="true"]')).toBeNull()
    await click('Save')
    expect(api.saveArtifact).toHaveBeenCalledWith({
      workspacePath: record.workspacePath,
      input: { name: 'Untitled artifact', id: undefined, kind: 'html', content: '<h1>new</h1>' },
    })
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toContain('Created')
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-pressed="false"]')!.click())
    expect(content().value).toBe(record.content)
    expect(api.listArtifacts).toHaveBeenCalledTimes(2)
  })

  it('keeps edits started while the initial empty list is loading and refreshes the preview', async () => {
    const pending = deferred<ArtifactRecord[]>()
    api.listArtifacts.mockReturnValueOnce(pending.promise)
    await render()
    await edit('<p>empty workspace draft</p>')
    await act(async () => pending.resolve([]))
    expect(content().value).toBe('<p>empty workspace draft</p>')
    expect(preview()).toBe('<p>empty workspace draft</p>')
    expect(button('Save').disabled).toBe(false)
  })

  it.each(['late read', 'late save', 'late error'] as const)('isolates a workspace switch from %s', async (scenario) => {
    const pendingList = deferred<ArtifactRecord[]>()
    const pendingSave = deferred<ArtifactRecord>()
    const other = { ...record, id: 'other', workspacePath: 'C:/other', content: '<p>other</p>' }
    api.listArtifacts.mockResolvedValueOnce([record])
    if (scenario !== 'late save') api.listArtifacts.mockReturnValueOnce(pendingList.promise)
    api.listArtifacts.mockResolvedValueOnce([other])
    api.saveArtifact.mockReturnValueOnce(pendingSave.promise)
    await render()
    await click(scenario === 'late save' ? 'Save' : 'Refresh')
    await render(other.workspacePath)
    await act(async () => {
      if (scenario === 'late read') pendingList.resolve([record])
      if (scenario === 'late save') pendingSave.resolve(record)
      if (scenario === 'late error') pendingList.reject(new Error('old workspace failed'))
    })
    expect(content().value).toBe(other.content)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(button('Save').disabled).toBe(false)
  })
})
