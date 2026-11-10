import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'

const state = vi.hoisted(() => ({
  documents: [],
  documentCollection: { isLoaded: true, isLoading: false, loadError: false },
  fetchDocuments: vi.fn(),
  selectedDoc: null,
  markdownContent: '',
  isDirty: true,
  isSaving: false,
  documentTextTooLarge: false,
  ingestionProgress: { active: false },
  leftPaneRef: { current: null },
  handleSaveDocument: vi.fn(async () => {}),
  handleExportMarkdown: vi.fn(async () => {}),
}))
vi.mock('../../hooks/useIngestion', () => ({ useIngestion: () => state }))
vi.mock('./VectorSearchPanel', () => ({ VectorSearchPanel: () => null }))
vi.mock('./DocumentListTable', () => ({ DocumentListTable: () => null }))

import { IngestionView } from './IngestionView'

describe('IngestionView save shortcuts', () => {
  let root: Root
  let container: HTMLDivElement
  beforeEach(() => {
    state.handleSaveDocument.mockClear()
    state.isSaving = false
    state.documentTextTooLarge = false
    state.handleExportMarkdown.mockClear()
    container = document.createElement('div')
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
  })
  const render = async (isActive: boolean) => {
    await act(async () =>
      root.render(
        <I18nProvider initialLanguage="en">
          <IngestionView isActive={isActive} />
        </I18nProvider>,
      ),
    )
  }
  const shortcut = async (metaKey = false) => {
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: !metaKey, metaKey, cancelable: true })
    await act(async () => {
      window.dispatchEvent(event)
    })
    return event
  }
  it('leaves shortcuts untouched while hidden and saves only the active view', async () => {
    await render(false)
    expect((await shortcut()).defaultPrevented).toBe(false)
    expect(state.handleSaveDocument).not.toHaveBeenCalled()
    await render(true)
    expect((await shortcut()).defaultPrevented).toBe(true)
    expect(state.handleSaveDocument).toHaveBeenCalledTimes(1)
    expect((await shortcut(true)).defaultPrevented).toBe(true)
    expect(state.handleSaveDocument).toHaveBeenCalledTimes(2)
    await render(false)
    expect((await shortcut()).defaultPrevented).toBe(false)
    expect(state.handleSaveDocument).toHaveBeenCalledTimes(2)
  })
  it('does not start a second save while the active view is saving', async () => {
    state.isSaving = true
    await render(true)
    await shortcut()
    expect(state.handleSaveDocument).not.toHaveBeenCalled()
  })
  it('shows an actionable Markdown recovery warning and refuses the save shortcut for oversized text', async () => {
    state.documentTextTooLarge = true
    await render(true)
    const warning = container.querySelector('[role="alert"]')
    expect(warning?.textContent).toContain('Export the complete text as Markdown')
    const exportButton = warning?.querySelector('button')
    if (!exportButton) throw new Error('Markdown recovery action missing')
    await act(async () => exportButton.click())
    expect(state.handleExportMarkdown).toHaveBeenCalledWith('md')
    await shortcut()
    expect(state.handleSaveDocument).not.toHaveBeenCalled()
  })
})
