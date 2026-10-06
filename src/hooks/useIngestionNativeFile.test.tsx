// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'

vi.mock('./useIngestedDocuments', () => ({
  notifyDocumentsChanged: vi.fn(),
  useIngestedDocuments: () => ({ documents: [], refetchDocuments: vi.fn(async () => {}) }),
}))
vi.mock('./useOllamaModelMetrics', () => ({ useOllamaModelMetrics: () => ({ metrics: {} }) }))

import { useIngestion } from './useIngestion'

describe('native ingestion file identity', () => {
  let root: Root
  let ingestion: ReturnType<typeof useIngestion>
  const resolveNativeFilePath = vi.fn()
  const ingestFile = vi.fn()
  const openFileDialog = vi.fn()

  function Harness() {
    ingestion = useIngestion()
    return <div role="alert">{ingestion.uploadError}</div>
  }

  beforeEach(async () => {
    resolveNativeFilePath.mockReset().mockReturnValue('')
    ingestFile.mockReset().mockResolvedValue({ success: false, error: 'Isolated backend refusal' })
    openFileDialog.mockReset()
    window.electronAPI = { resolveNativeFilePath, ingestFile, openFileDialog } as unknown as NonNullable<typeof window.electronAPI>
    root = createRoot(document.createElement('div'))
    await act(async () =>
      root.render(
        <I18nProvider initialLanguage="en">
          <Harness />
        </I18nProvider>,
      ),
    )
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    delete window.electronAPI
  })

  it('refuses a JavaScript file without a disk path instead of ingesting its basename', async () => {
    const file = new File(['synthetic'], 'report.md')
    await act(async () => ingestion.handleFileUpload(file))
    expect(resolveNativeFilePath).toHaveBeenCalledWith({ file })
    expect(ingestFile).not.toHaveBeenCalled()
    expect(ingestion.uploadError).toContain('local disk path')
    expect(ingestion.isUploading).toBe(false)
    expect(ingestion.ingestionProgress.active).toBe(false)
  })

  it('preserves distinct native paths for files with the same basename', async () => {
    const first = new File(['first'], 'report.md')
    const second = new File(['second'], 'report.md')
    const paths = new Map([
      [first, 'C:/first/report.md'],
      [second, 'C:/second/report.md'],
    ])
    resolveNativeFilePath.mockImplementation(({ file }: { file: File }) => paths.get(file))
    Object.defineProperty(first, 'path', { value: 'C:/wrong/report.md' })
    await act(async () => {
      await ingestion.handleFileUpload(first)
      await ingestion.handleFileUpload(second)
    })
    expect(ingestFile.mock.calls.map(([payload]) => payload.filePath)).toEqual([...paths.values()])
    expect(resolveNativeFilePath.mock.calls.map(([payload]) => payload.file)).toEqual([first, second])
  })

  it('shows an error and never ingests when native resolution throws', async () => {
    resolveNativeFilePath.mockImplementation(() => {
      throw new TypeError('Expected a File')
    })
    await act(async () => ingestion.handleFileUpload({ name: 'report.md' } as File))
    expect(ingestFile).not.toHaveBeenCalled()
    expect(ingestion.uploadError).toContain('local disk path')
    expect(ingestion.isUploading).toBe(false)
  })

  it('keeps the native dialog path unchanged without resolving a DOM File', async () => {
    openFileDialog.mockResolvedValue(['C:/second/report.md'])
    await act(async () => ingestion.handleSelectFileNative())
    expect(ingestFile).toHaveBeenCalledWith(expect.objectContaining({ filePath: 'C:/second/report.md' }))
    expect(resolveNativeFilePath).not.toHaveBeenCalled()
  })
})
