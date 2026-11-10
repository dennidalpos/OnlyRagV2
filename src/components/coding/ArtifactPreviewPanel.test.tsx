import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtifactPreviewPanel } from './ArtifactPreviewPanel'
import type { ArtifactRecord } from '../../types'

const record: ArtifactRecord = {
  id: 'a1',
  workspacePath: 'C:\\ws',
  name: 'Recovered',
  kind: 'html',
  content: '<p>ok</p>',
  createdAt: '2026-11-07T00:00:00.000Z',
  updatedAt: '2026-11-07T00:00:00.000Z',
}

describe('ArtifactPreviewPanel store errors', () => {
  let container: HTMLDivElement
  let root: Root
  const api = { listArtifacts: vi.fn(), saveArtifact: vi.fn(), deleteArtifact: vi.fn() }

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

  it('shows the load error instead of an empty list and recovers on retry', async () => {
    api.listArtifacts.mockRejectedValueOnce(new Error('Artifact record is not valid JSON')).mockResolvedValue([record])
    await act(async () => root.render(<ArtifactPreviewPanel workspacePath="C:\\ws" />))

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('not valid JSON')
    expect(api.saveArtifact).not.toHaveBeenCalled()

    const retry = container.querySelector('[role="alert"] button') as HTMLButtonElement
    await act(async () => retry.click())
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('Recovered')
    expect(api.listArtifacts.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('shows a save error and keeps the draft', async () => {
    api.listArtifacts.mockResolvedValue([record])
    api.saveArtifact.mockRejectedValueOnce(new Error('could not be confirmed by readback'))
    await act(async () => root.render(<ArtifactPreviewPanel workspacePath="C:\\ws" />))

    const save = [...container.querySelectorAll('button')].find((b) => b.className.includes('bg-cyan-600')) as HTMLButtonElement
    await act(async () => save.click())
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('readback')
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('<p>ok</p>')
  })
})
