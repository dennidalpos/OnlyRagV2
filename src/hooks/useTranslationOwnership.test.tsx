import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import type { AppSettings, IngestedDocument } from '../types'
import { clearDocumentMarkdownCache } from '../services/documentMarkdown'
import { peekGlobalTaskLock } from '../services/globalTaskLock'

const doc = { id: 'pdf', filename: 'report.pdf', fileType: 'pdf', numPages: 2, ingestedAt: 't1' } as IngestedDocument
let updateDocuments: (docs: IngestedDocument[]) => void
vi.mock('./useIngestedDocuments', () => ({
  useIngestedDocuments: ({ onDocsUpdated }: { onDocsUpdated: typeof updateDocuments }) => {
    updateDocuments = onDocsUpdated
    return { documents: [doc], refetchDocuments: vi.fn(async () => {}) }
  },
}))
vi.mock('./useOllamaModelMetrics', () => ({ useOllamaModelMetrics: () => ({ metrics: {} }) }))

import { useDocumentTranslation, useInplaceTranslation, useSharedTranslationState } from './useTranslation'

describe('translation preparation and settlement ownership', () => {
  let root: Root | null
  let translation: ReturnType<typeof useDocumentTranslation>
  let inplace: ReturnType<typeof useInplaceTranslation>
  let load: (markdown: string | null) => void
  const streams: { id: string; chunk: (text: string) => void; finish: (result: { success: boolean; error?: string }) => void; fail: (error: Error) => void }[] =
    []
  const generate = vi.fn()
  const cancel = vi.fn(async () => ({ success: true }))
  const translateInplace = vi.fn()
  const settings = { translationModel: 'translator:latest', translationOutputFolder: 'C:/synthetic-output' } as AppSettings

  function Harness() {
    const shared = useSharedTranslationState()
    translation = useDocumentTranslation(settings, null, shared)
    inplace = useInplaceTranslation(settings, null, shared)
    return null
  }

  async function resolveLoad(markdown = '# Report') {
    await act(async () => {
      load(markdown)
    })
  }
  async function start() {
    let running!: Promise<void>
    await act(async () => {
      running = translation.handleStartTranslation()
    })
    return { running }
  }
  beforeEach(async () => {
    streams.length = 0
    clearDocumentMarkdownCache()
    cancel.mockClear()
    translateInplace.mockReset()
    generate.mockReset().mockImplementation(
      (request: { operationId: string }, chunk: (text: string) => void) =>
        new Promise((finish, fail) => {
          streams.push({ id: request.operationId, chunk, finish, fail })
        }),
    )
    window.electronAPI = {
      getIngestedDocument: vi.fn(
        () =>
          new Promise((resolve) => {
            load = (markdown) => resolve(markdown === null ? null : { ...doc, extractedMarkdown: markdown })
          }),
      ),
      generateOllamaStream: generate,
      cancelOllamaStream: cancel,
      translateDocumentInplace: translateInplace,
    } as unknown as NonNullable<typeof window.electronAPI>
    root = createRoot(document.createElement('div'))
    await act(async () =>
      root!.render(
        <I18nProvider initialLanguage="en">
          <Harness />
        </I18nProvider>,
      ),
    )
    await act(async () => {
      updateDocuments([doc])
      translation.setSelectedDoc(doc)
    })
  })
  afterEach(async () => {
    if (root) await act(async () => root!.unmount())
    expect(peekGlobalTaskLock()).toBeNull()
    delete window.electronAPI
  })

  it('claims loading synchronously and blocks duplicate and sibling jobs before rendering', async () => {
    let running!: Promise<void>
    await act(async () => {
      running = translation.handleStartTranslation()
      expect(peekGlobalTaskLock()).toBe('translation')
      await translation.handleStartTranslation()
      await inplace.handleStartInplaceTranslation()
    })
    expect(translation.isTranslating).toBe(true)
    expect(inplace.otherJobRunning).toBe(true)
    expect(translateInplace).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
    await act(async () => translation.handleStopTranslation())
    await resolveLoad()
    await act(async () => running)
    expect(generate).not.toHaveBeenCalled()
  })

  it('starts only the new operation when a shared loading request settles after Stop/restart', async () => {
    const first = await start()
    await act(async () => translation.handleStopTranslation())
    const second = await start()
    await resolveLoad()
    await act(async () => first.running)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(translation.isTranslating).toBe(true)
    await act(async () => {
      streams[0].chunk('New translation')
      streams[0].finish({ success: true })
      await second.running
    })
    expect(translation.isTranslationComplete).toBe(true)
  })

  it('resets a queued stream and ignores late tokens and errors', async () => {
    await resolveLoad()
    const job = await start()
    expect(translation.generationState).toBe('queued')
    await act(async () => translation.handleResetTranslation())
    expect(cancel).toHaveBeenCalledWith({ operationId: streams[0].id })
    await act(async () => {
      streams[0].chunk('OLD')
      streams[0].fail(new Error('Old failure'))
      await job.running
    })
    expect(translation.translatedMarkdown).toBe('')
    expect(translation.translationError).toBeNull()
    expect(translation.isTranslationComplete).toBe(false)
    expect(translation.generationState).toBeNull()
    expect(translation.isTranslating).toBe(false)
  })

  it('never dispatches a generation after unmount during preparation', async () => {
    const job = await start()
    await act(async () => root!.unmount())
    root = null
    await resolveLoad()
    await job.running
    expect(generate).not.toHaveBeenCalled()
  })

  it('cancels its stream on unmount and keeps a newer mounted job locked', async () => {
    await resolveLoad()
    const old = await start()
    const oldStream = streams[0]
    await act(async () => root!.unmount())
    expect(cancel).toHaveBeenCalledWith({ operationId: oldStream.id })
    root = createRoot(document.createElement('div'))
    await act(async () =>
      root!.render(
        <I18nProvider initialLanguage="en">
          <Harness />
        </I18nProvider>,
      ),
    )
    await act(async () => {
      updateDocuments([doc])
      translation.setSelectedDoc(doc)
    })
    const next = await start()
    await act(async () => {
      oldStream.chunk('Old')
      oldStream.finish({ success: false, error: 'Stopped' })
      await old.running
    })
    expect(translation.isTranslating).toBe(true)
    expect(peekGlobalTaskLock()).toBe('translation')
    expect(translation.translationError).toBeNull()
    await act(async () => {
      streams[1].chunk('New')
      streams[1].finish({ success: true })
      await next.running
    })
    expect(translation.isTranslationComplete).toBe(true)
  })

  it('keeps partial output incomplete and refuses export when a later chunk fails', async () => {
    await resolveLoad('A'.repeat(3000) + '\n\n' + 'B'.repeat(3000))
    const exportDocument = vi.fn()
    window.electronAPI = { ...window.electronAPI!, exportDocument }
    const job = await start()
    await act(async () => {
      streams[0].chunk('First part')
      streams[0].finish({ success: true })
    })
    expect(streams).toHaveLength(2)
    await act(async () => {
      streams[1].chunk('Partial second part')
      streams[1].finish({ success: false, error: 'Backend refused' })
      await job.running
    })
    expect(translation.translatedMarkdown).toBe('First part\n\nPartial second part')
    expect(translation.isTranslationComplete).toBe(false)
    expect(translation.translationError).toContain('Backend refused')
    await act(async () => translation.handleExportTranslation('md'))
    expect(exportDocument).not.toHaveBeenCalled()
  })

  it('invalidates output on revision and page changes and ignores export settlement after Reset', async () => {
    await resolveLoad()
    const job = await start()
    await act(async () => {
      streams[0].chunk('Finished')
      streams[0].finish({ success: true })
      await job.running
    })
    let finishExport!: (result: { success: boolean; message: string }) => void
    window.electronAPI = {
      ...window.electronAPI!,
      exportDocument: vi.fn(
        () =>
          new Promise<{ success: boolean; message: string }>((resolve) => {
            finishExport = resolve
          }),
      ),
    }
    let exporting!: Promise<void>
    await act(async () => {
      exporting = translation.handleExportTranslation('md')
    })
    await act(async () => translation.handleResetTranslation())
    await act(async () => {
      finishExport({ success: true, message: 'Old export finished' })
      await exporting
    })
    expect(translation.exportMessage).toBeNull()
    await act(async () => translation.setSelectedDoc(doc))
    const second = await start()
    await act(async () => {
      streams[1].chunk('Finished again')
      streams[1].finish({ success: true })
      await second.running
    })
    await act(async () => translation.setPageViewMode('page'))
    expect(translation.isTranslationComplete).toBe(false)
    expect(translation.translatedMarkdown).toBe('')
    await act(async () => translation.setSelectedDoc({ ...doc, ingestedAt: 't2' }))
    expect(translation.isTranslationComplete).toBe(false)
  })
})
