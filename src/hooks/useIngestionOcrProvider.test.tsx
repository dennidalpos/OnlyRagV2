// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../shared/domain/settings/appSettingsDefaults'
import { OcrEngineBadge } from '../components/ingestion/OcrEngineBadge'
import { I18nProvider } from '../i18n'
import { resolveNativeOcrProvider } from '../lib/ocrProvider'
import type { AppSettings, DiagnosticsData } from '../types'

vi.mock('./useIngestedDocuments', () => ({
  notifyDocumentsChanged: vi.fn(),
  useIngestedDocuments: () => ({ documents: [], refetchDocuments: vi.fn(async () => {}) }),
}))
vi.mock('./useOllamaModelMetrics', () => ({ useOllamaModelMetrics: () => ({ metrics: {} }) }))

import { useIngestion } from './useIngestion'

function diagnosticsWith(sidecar: Partial<DiagnosticsData['sidecar']>): DiagnosticsData {
  return {
    sidecar: { status: 'online', ...sidecar },
    gpu: { hasNvidiaGpu: false },
    memory: { totalRAMGB: 16 },
    system: { cpusCount: 8 },
  } as DiagnosticsData
}

const CUDA = diagnosticsWith({ ocr: { provider: 'CUDAExecutionProvider', host_has_gpu: true } })
const CPU = diagnosticsWith({ ocr: { provider: 'CPUExecutionProvider', host_has_gpu: false } })
const CPU_WITH_GPU_HOST = diagnosticsWith({ ocr: { provider: 'CPUExecutionProvider', host_has_gpu: true } })
const CHECKING = diagnosticsWith({ status: 'checking' })
const STALE_OFFLINE = diagnosticsWith({ status: 'offline', ocr: { provider: 'CUDAExecutionProvider', host_has_gpu: true } })
const MISSING = diagnosticsWith({})
const UNRECOGNIZED = diagnosticsWith({ ocr: { provider: 'DmlExecutionProvider', host_has_gpu: true } })

describe('resolveNativeOcrProvider', () => {
  it.each([
    ['CUDA online', CUDA, 'cuda'],
    ['CPU online', CPU, 'cpu'],
    ['Sidecar checking', CHECKING, 'unknown'],
    ['stale provider while offline', STALE_OFFLINE, 'unknown'],
    ['provider missing', MISSING, 'unknown'],
    ['unrecognized provider', UNRECOGNIZED, 'unknown'],
    ['no diagnostics', null, 'unknown'],
  ] as const)('%s', (_label, diagnostics, expected) => {
    expect(resolveNativeOcrProvider(diagnostics)).toBe(expected)
  })
})

describe('ingestion progress OCR provider label', () => {
  let root: Root
  let ingestion: ReturnType<typeof useIngestion>
  let settings: AppSettings
  let diagnostics: DiagnosticsData | null
  let language: 'en' | 'it'
  let finishIngestion: (value: unknown) => void
  const ingestFile = vi.fn()
  const openFileDialog = vi.fn()

  function Harness() {
    ingestion = useIngestion(settings, diagnostics)
    return null
  }

  async function render() {
    await act(async () =>
      root.render(
        <I18nProvider initialLanguage={language}>
          <Harness />
        </I18nProvider>,
      ),
    )
  }

  /** Starts an ingestion and reads the progress while the Sidecar call is still pending. */
  async function progressFor(filePath: string) {
    openFileDialog.mockResolvedValue([filePath])
    let pending!: Promise<void>
    await act(async () => {
      pending = ingestion.handleSelectFileNative()
    })
    const progress = { ...ingestion.ingestionProgress }
    await act(async () => {
      finishIngestion({ success: false, error: 'Isolated backend refusal' })
      await pending
    })
    return progress
  }

  beforeEach(async () => {
    settings = { ...DEFAULT_APP_SETTINGS, ocrEngine: 'native_cuda' }
    diagnostics = null
    language = 'en'
    ingestFile.mockReset().mockImplementation(
      () =>
        new Promise((resolve) => {
          finishIngestion = resolve
        }),
    )
    openFileDialog.mockReset()
    window.electronAPI = {
      ingestFile,
      openFileDialog,
      loadDocumentDrafts: vi.fn(async () => ({ revision: 'missing', drafts: [] })),
      saveDocumentDrafts: vi.fn(async (snapshot: import('../../shared/domain/documentDraft').DocumentDraftSnapshot) => snapshot),
    } as unknown as NonNullable<typeof window.electronAPI>
    root = createRoot(document.createElement('div'))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    delete window.electronAPI
  })

  it.each([
    ['CUDA', CUDA, 'C:/fixture/scan.png', 'RapidOCR (CUDA)'],
    ['CPU', CPU, 'C:/fixture/scan.png', 'RapidOCR (CPU)'],
    ['CPU on a GPU host', CPU_WITH_GPU_HOST, 'C:/fixture/scan.jpg', 'RapidOCR (CPU)'],
    ['checking', CHECKING, 'C:/fixture/scan.png', 'RapidOCR (provider pending)'],
    ['stale offline', STALE_OFFLINE, 'C:/fixture/scan.png', 'RapidOCR (provider pending)'],
    ['missing', MISSING, 'C:/fixture/scan.bmp', 'RapidOCR (provider pending)'],
    ['unrecognized', UNRECOGNIZED, 'C:/fixture/scan.webp', 'RapidOCR (provider pending)'],
    ['no diagnostics', null, 'C:/fixture/scan.png', 'RapidOCR (provider pending)'],
    ['CUDA PDF', CUDA, 'C:/fixture/report.pdf', 'PyMuPDF / RapidOCR (CUDA)'],
    ['CPU PDF', CPU, 'C:/fixture/report.pdf', 'PyMuPDF / RapidOCR (CPU)'],
    ['checking PDF', CHECKING, 'C:/fixture/report.pdf', 'PyMuPDF / RapidOCR (provider pending)'],
  ] as const)('native OCR follows the runtime provider: %s', async (_label, facts, filePath, expected) => {
    diagnostics = facts
    await render()
    const progress = await progressFor(filePath)
    expect(progress.ocrTechnology).toBe(expected)
    expect(progress.step).toBe(`Extracting layout & OCR (${expected})...`)
    if (facts !== CUDA) {
      expect(`${progress.ocrTechnology} ${progress.step} ${progress.pipeline} ${progress.modelName}`).not.toMatch(/cuda/i)
    }
  })

  it('localizes the unknown provider state in Italian', async () => {
    language = 'it'
    diagnostics = CHECKING
    await render()
    expect((await progressFor('C:/fixture/scan.png')).ocrTechnology).toBe('RapidOCR (provider in verifica)')
  })

  it('keeps the Vision OCR label and RapidOCR fallback without a provider claim', async () => {
    settings = { ...DEFAULT_APP_SETTINGS, ocrEngine: 'vision_model', visionModel: 'fixture-vision' }
    diagnostics = CUDA
    await render()
    expect((await progressFor('C:/fixture/scan.png')).ocrTechnology).toBe('Vision LLM OCR (fixture-vision) + RapidOCR fallback')
    expect((await progressFor('C:/fixture/report.pdf')).ocrTechnology).toBe('PyMuPDF / Vision LLM OCR (fixture-vision) + RapidOCR fallback')
    expect(ingestFile).toHaveBeenLastCalledWith(expect.objectContaining({ visionModel: 'fixture-vision', visionPrompt: expect.any(String) }))
  })

  it('preserves the explicit operational error after a provider-labelled attempt', async () => {
    diagnostics = CPU
    await render()
    await progressFor('C:/fixture/scan.png')
    expect(ingestion.uploadError).toBe('Isolated backend refusal')
    expect(ingestion.ingestionProgress.active).toBe(false)
  })
})

describe('OcrEngineBadge provider state', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
  })

  it.each([
    ['CUDA online', CUDA, 'GPU ON'],
    ['CPU online', CPU, 'CPU'],
    ['CPU on a GPU host', CPU_WITH_GPU_HOST, 'GPU Present (ONNX CPU)'],
    ['stale CUDA while offline', STALE_OFFLINE, 'GPU Present (ONNX CPU)'],
  ] as const)('%s', async (_label, facts, expected) => {
    await act(async () =>
      root.render(
        <I18nProvider initialLanguage="en">
          <OcrEngineBadge settings={{ ...DEFAULT_APP_SETTINGS, ocrEngine: 'native_cuda' }} diagnostics={facts} />
        </I18nProvider>,
      ),
    )
    expect(container.textContent).toContain(expected)
    if (facts !== CUDA) expect(container.textContent).not.toContain('GPU ON')
  })
})
