import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'

const state = vi.hoisted(() => ({
  documents: [],
  selectedDoc: null,
  markdownContent: '',
  isDirty: true,
  isSaving: false,
  ingestionProgress: { active: false },
  leftPaneRef: { current: null },
  handleSaveDocument: vi.fn(async () => {}),
}))
vi.mock('../../hooks/useIngestion', () => ({ useIngestion: () => state }))
vi.mock('./VectorSearchPanel', () => ({ VectorSearchPanel: () => null }))
vi.mock('./DocumentListTable', () => ({ DocumentListTable: () => null }))

import { IngestionView } from './IngestionView'

describe('IngestionView save shortcuts', () => {
  let root: Root
  beforeEach(() => {
    state.handleSaveDocument.mockClear()
    state.isSaving = false
    root = createRoot(document.createElement('div'))
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
})
