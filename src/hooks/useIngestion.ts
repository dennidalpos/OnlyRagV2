import type { editor } from 'monaco-editor'
import { useState, useEffect, useRef, useCallback } from 'react'
import { IngestedDocument, AppSettings, DiagnosticsData, IngestionStreamProgressPayload } from '../types'
import { apiService } from '../services/api'
import { logger } from '../lib/logger'
import { useIngestedDocuments, notifyDocumentsChanged } from './useIngestedDocuments'
import { useDocumentMarkdown } from './useDocumentMarkdown'
import { peekDocumentMarkdown, primeDocumentMarkdown } from '../services/documentMarkdown'
import { useTranslation as useI18n, type TranslationKey } from '../i18n'
import { acquireGlobalTaskLock, releaseGlobalTaskLock, peekGlobalTaskLock } from '../services/globalTaskLock'
import { normalizeError } from '../lib/errors/errorNormalizer'
import { resolveNodeTemplate } from '../constants/promptConfig'
import { extractHardwareFacts } from '../services/hardwareRecommendationEngine'
import { resolveMaxContextTokens } from '../../shared/domain/hardware/hardwareProfileTiers'
import { resolveModelContextLength } from '../../shared/domain/settings/modelContextPreference'
import { useOllamaModelMetrics } from './useOllamaModelMetrics'

/** The `images:analysis` template that goes on the wire, or `undefined` to stay on local RapidOCR. */
export function resolveVisionOcrPrompt(settings?: AppSettings): string | undefined {
  if (settings?.ocrEngine !== 'vision_model') return undefined
  return resolveNodeTemplate('images:analysis', settings).template || undefined
}

export interface IngestionProgressState {
  taskId?: string
  active: boolean
  fileName: string
  step: string
  percent: number
  pipeline?: string
  modelName?: string
  ocrTechnology?: string
  fileCategory?: string
}

export function getPageLineNumber(content: string, targetPage: number): number {
  if (!content || targetPage <= 1) return 1
  const lines = content.split('\n')
  let pageIndex = 1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (/^##\s+(?:Page\s+\d+|Image)/i.test(line)) {
      if (pageIndex === targetPage) {
        return i + 1
      }
      pageIndex++
    }
  }
  if (pageIndex === 1) {
    let hrIndex = 1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        hrIndex++
        if (hrIndex === targetPage) {
          return i + 2
        }
      }
    }
  }
  return 1
}

export function getTotalLines(content: string): number {
  return content ? content.split('\n').length : 1
}

export async function runDocumentDeletion(
  id: string,
  onFailure: (message?: string) => void,
  onSuccess: () => void,
  deleteDocument: (docId: string) => Promise<{ success: boolean; error?: string }> = apiService.deleteIngestedDocument,
): Promise<boolean> {
  const result = await deleteDocument(id)
  if (!result.success) {
    onFailure(result.error)
    return false
  }
  onSuccess()
  return true
}

/** The Sidecar's locale-neutral progress code in the UI language, or its English fallback text. */
export function sidecarStepText(
  payload: Pick<IngestionStreamProgressPayload, 'step' | 'step_code' | 'step_params'>,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  if (payload.step_code) {
    const key = `ingestionSteps.${payload.step_code}` as TranslationKey
    const translated = t(key, payload.step_params)
    if (translated !== key) return translated
  }
  return payload.step
}

export function useIngestion(settings?: AppSettings, diagnostics?: DiagnosticsData | null) {
  const hardwareDefault = resolveMaxContextTokens('Auto', extractHardwareFacts(diagnostics || null))
  const { metrics: modelMetrics } = useOllamaModelMetrics(settings?.ollamaHost)
  const { t } = useI18n()
  const [isPromptModalOpen, setIsPromptModalOpen] = useState<boolean>(false)
  const [selectedDoc, setSelectedDoc] = useState<IngestedDocument | null>(null)
  const [markdownContent, setMarkdownContent] = useState<string>('')
  const [isUploading, setIsUploading] = useState<boolean>(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [syncScroll, setSyncScroll] = useState<boolean>(true)
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [saveStatus, setSaveStatus] = useState<{ success: boolean; message: string } | null>(null)

  // Mirrors this module's busy state (upload/ingest pipeline) into the cross-module task lock
  // so the coding agent/translation module can block starting their own task while ingestion is mid-flight.
  const isIngestionBusy = isUploading
  useEffect(() => {
    if (!isIngestionBusy) return
    acquireGlobalTaskLock('ingestion')
    return () => releaseGlobalTaskLock('ingestion')
  }, [isIngestionBusy])

  // The document list carries metadata only: the selected document's Markdown is loaded on demand
  // and copied into the editor once per document version (see editorSourceRef below).
  const { markdown: loadedMarkdown } = useDocumentMarkdown(selectedDoc)
  const isDirty = selectedDoc !== null && loadedMarkdown !== null && markdownContent !== loadedMarkdown

  /** Which document version the editor content was loaded from; unsaved edits survive a refresh of the same document. */
  const editorSourceRef = useRef<{ id: string; ingestedAt: string; markdown: string } | null>(null)
  const selectedDocId = selectedDoc?.id
  const selectedDocVersion = selectedDoc?.ingestedAt
  useEffect(() => {
    if (!selectedDocId || selectedDocVersion === undefined || loadedMarkdown === null) return
    const source = editorSourceRef.current
    if (source?.id === selectedDocId && source.ingestedAt === selectedDocVersion) return
    editorSourceRef.current = { id: selectedDocId, ingestedAt: selectedDocVersion, markdown: loadedMarkdown }
    setMarkdownContent((current) => (source?.id === selectedDocId && current !== source.markdown ? current : loadedMarkdown))
  }, [selectedDocId, selectedDocVersion, loadedMarkdown])

  /** Selects a document; the editor stays empty (and unsaveable) until its Markdown is loaded. */
  const showDocument = useCallback((doc: IngestedDocument | null) => {
    setSelectedDoc(doc)
    if (doc && editorSourceRef.current?.id === doc.id) return
    editorSourceRef.current = null
    setMarkdownContent(doc ? (peekDocumentMarkdown(doc) ?? '') : '')
  }, [])

  const [ingestionProgress, setIngestionProgress] = useState<IngestionProgressState>({
    active: false,
    fileName: '',
    step: '',
    percent: 0,
  })

  const activeTaskIdRef = useRef<string | null>(null)

  const selectedDocRef = useRef<IngestedDocument | null>(null)
  selectedDocRef.current = selectedDoc

  const handleDocUpdateCallback = useCallback(
    (docs: IngestedDocument[]) => {
      const prev = selectedDocRef.current
      // A deleted selection falls back to the first document, as does an empty one.
      showDocument((prev && docs.find((d) => d.id === prev.id)) || docs[0] || null)
    },
    [showDocument],
  )

  const { documents, refetchDocuments: fetchDocuments } = useIngestedDocuments({
    onDocsUpdated: handleDocUpdateCallback,
  })

  const handleCancelIngestion = async () => {
    const taskId = activeTaskIdRef.current
    if (!taskId) return
    if (window.electronAPI?.cancelTask) {
      await window.electronAPI.cancelTask(taskId)
    }
    activeTaskIdRef.current = null
    setIngestionProgress({ active: false, fileName: '', step: '', percent: 0 })
    setIsUploading(false)
    setUploadError(t('ingestion.cancelledByUser'))
  }

  // Real-time streaming progress subscription from Electron/FastAPI sidecar
  useEffect(() => {
    if (!window.electronAPI?.onIngestStreamProgress) return

    const unsubscribe = window.electronAPI.onIngestStreamProgress((payload) => {
      if (payload.taskId !== activeTaskIdRef.current) return
      if (payload.type === 'progress') {
        setIngestionProgress((prev) => ({
          ...prev,
          active: true,
          fileName: payload.fileName || prev.fileName,
          step: sidecarStepText(payload, t) || prev.step,
          percent: typeof payload.percent === 'number' ? payload.percent : prev.percent,
          pipeline: payload.pipeline || prev.pipeline,
          modelName: payload.modelName || prev.modelName,
          ocrTechnology: payload.ocrTechnology || prev.ocrTechnology,
        }))
      } else if (payload.type === 'done') {
        setIngestionProgress((prev) => ({
          ...prev,
          active: true,
          fileName: payload.fileName || prev.fileName,
          step: t('ingestion.stepCompleted'),
          percent: 100,
          pipeline: t('ingestion.pipelineCompleted'),
        }))
      }
    })

    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [])

  const [currentPage, setCurrentPage] = useState<number>(1)
  const [viewMode, setViewMode] = useState<'page' | 'all'>('page')
  const [zoomLevel, setZoomLevel] = useState<number>(100)

  const [exportStatus, setExportStatus] = useState<{ active: boolean; message: string; isError?: boolean } | null>(null)
  const leftPaneRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const isSyncingScrollRef = useRef<boolean>(false)
  const scrollRafRef = useRef<number | null>(null)

  const scrollToPage = useCallback(
    (targetPage: number) => {
      setCurrentPage(targetPage)

      if (editorRef.current && markdownContent) {
        const targetLine = getPageLineNumber(markdownContent, targetPage)
        editorRef.current.revealLineNearTop(targetLine)
        editorRef.current.setPosition({ lineNumber: targetLine, column: 1 })
      }

      if (viewMode === 'page' && leftPaneRef.current) {
        leftPaneRef.current.scrollTop = 0
      } else if (viewMode === 'all' && leftPaneRef.current) {
        // Match by data-page-number (set by every page card, image-backed or text-fallback alike) rather than a fixed id -- SourcePagePreview only renders a `rendered-page-N` id for the no-scanned-image fallback case, so an id lookup silently no-ops for image-backed pag
        const targetElem = leftPaneRef.current.querySelector<HTMLElement>(`[data-page-number="${targetPage}"]`)
        if (targetElem) {
          const offset = targetElem.offsetTop - leftPaneRef.current.offsetTop
          leftPaneRef.current.scrollTo({ top: Math.max(0, offset - 10), behavior: 'smooth' })
        }
      }
    },
    [markdownContent, viewMode],
  )

  const handleLeftPaneScroll = () => {
    if (!syncScroll || isSyncingScrollRef.current || !leftPaneRef.current || !editorRef.current) return
    if (scrollRafRef.current !== null) return

    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      if (!syncScroll || !leftPaneRef.current || !editorRef.current) return
      isSyncingScrollRef.current = true

      const { scrollTop, scrollHeight, clientHeight } = leftPaneRef.current
      const maxScroll = scrollHeight - clientHeight

      if (viewMode === 'all') {
        // Scroll spy: identify visible page card with single parentRect query and early exit
        const pageElements = leftPaneRef.current.querySelectorAll('[data-page-number]')
        const parentRect = leftPaneRef.current.getBoundingClientRect()
        for (let i = 0; i < pageElements.length; i++) {
          const el = pageElements[i]
          const rect = el.getBoundingClientRect()
          if (rect.top <= parentRect.top + 100 && rect.bottom >= parentRect.top + 100) {
            const pageNum = Number(el.getAttribute('data-page-number'))
            if (pageNum && pageNum !== currentPage) {
              setCurrentPage(pageNum)
            }
            break
          }
        }

        if (maxScroll > 0) {
          const scrollPercent = scrollTop / maxScroll
          const editorScrollHeight = editorRef.current.getScrollHeight()
          const editorLayout = editorRef.current.getLayoutInfo()
          const editorClientHeight = editorLayout ? editorLayout.height : 0
          const maxEditorScroll = editorScrollHeight - editorClientHeight
          if (maxEditorScroll > 0) {
            editorRef.current.setScrollTop(scrollPercent * maxEditorScroll)
          }
        }
      } else {
        // Single Page Mode: scroll proportionally within current page line span
        if (maxScroll > 0) {
          const scrollPercent = scrollTop / maxScroll
          const startLine = getPageLineNumber(markdownContent, currentPage)
          const nextLine = getPageLineNumber(markdownContent, currentPage + 1)
          const endLine = nextLine > startLine ? nextLine : getTotalLines(markdownContent)

          const startTop = editorRef.current.getTopForLineNumber(startLine) || 0
          const endTop = editorRef.current.getTopForLineNumber(endLine) || startTop
          const span = Math.max(0, endTop - startTop)

          editorRef.current.setScrollTop(startTop + scrollPercent * span)
        }
      }

      requestAnimationFrame(() => {
        isSyncingScrollRef.current = false
      })
    })
  }

  const handleEditorDidMount = (mounted: editor.IStandaloneCodeEditor) => {
    editorRef.current = mounted
    mounted.onDidScrollChange((e) => {
      if (!syncScroll || isSyncingScrollRef.current || !leftPaneRef.current) return
      if (!e.scrollTopChanged) return

      isSyncingScrollRef.current = true
      const editorScrollHeight = mounted.getScrollHeight()
      const editorLayout = mounted.getLayoutInfo()
      const editorClientHeight = editorLayout ? editorLayout.height : 0
      const maxEditorScroll = editorScrollHeight - editorClientHeight

      if (maxEditorScroll > 0) {
        const scrollPercent = e.scrollTop / maxEditorScroll
        const { scrollHeight, clientHeight } = leftPaneRef.current
        const maxScroll = scrollHeight - clientHeight
        if (maxScroll > 0) {
          leftPaneRef.current.scrollTop = scrollPercent * maxScroll
        }
      }

      requestAnimationFrame(() => {
        isSyncingScrollRef.current = false
      })
    })
  }

  const handleExportMarkdown = async (format: 'pdf' | 'md' = 'pdf') => {
    if (!selectedDoc || !markdownContent) return
    setExportStatus({ active: true, message: t('ingestion.exportPreparing', { format: format.toUpperCase() }) })
    try {
      const res = await apiService.exportDocument(markdownContent, format)
      if (res.success) {
        setExportStatus({ active: false, message: res.message || t('ingestion.exportSuccess', { format: format.toUpperCase() }) })
      } else {
        setExportStatus({ active: false, message: res.error || res.message || t('ingestion.exportCancelled'), isError: true })
      }
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'Ingestion')
      setExportStatus({ active: false, message: t('ingestion.exportError', { message: normalized.message }), isError: true })
    } finally {
      setTimeout(() => {
        setExportStatus(null)
      }, 5000)
    }
  }

  const handleSelectDoc = (doc: IngestedDocument) => {
    showDocument(doc)
    setCurrentPage(1)
    setExportStatus(null)
  }

  const handleDeleteDoc = async (id: string, filename?: string) => {
    try {
      const deleted = await runDocumentDeletion(
        id,
        (message) => setUploadError(t('ingestion.deleteError', { message: message || t('ingestion.deleteUnknownError') })),
        () => setUploadError(null),
      )
      if (!deleted) return
      notifyDocumentsChanged()
      if (selectedDoc?.id === id) {
        const remaining = documents.filter((d) => d.id !== id)
        if (remaining.length > 0) {
          handleSelectDoc(remaining[0])
        } else {
          showDocument(null)
        }
      }
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'Ingestion')
      logger.error('IngestionView', `Error deleting document ${filename || id}: ${normalized.message}`)
    }
  }

  const handleIngestPath = async (targetFilePath: string, displayName?: string) => {
    if (!targetFilePath || !targetFilePath.trim()) return

    const busyModule = peekGlobalTaskLock()
    if (busyModule && busyModule !== 'ingestion') {
      const message =
        busyModule === 'coding'
          ? t('common.crossModuleTaskBlocked', { module: t('common.moduleNameCoding') })
          : t('common.crossModuleTaskBlocked', { module: t('common.moduleNameTranslation') })
      setUploadError(message)
      return
    }

    const taskId = crypto.randomUUID()
    activeTaskIdRef.current = taskId
    setIsUploading(true)
    setUploadError(null)

    const baseName = displayName || targetFilePath.split(/[/\\]/).pop() || targetFilePath
    const ext = baseName.includes('.') ? baseName.split('.').pop()!.toLowerCase() : 'text'

    const visionPrompt = resolveVisionOcrPrompt(settings)
    const useVisionOcr = visionPrompt !== undefined
    const visionModelName = settings?.visionModel || 'llama3.2-vision'

    let detectedCategory = t('ingestion.categoryText')
    let initialPipeline = 'Fast-Router: Pre-analisi & Classificazione'
    let ocrTech = 'PyMuPDF Text Extraction'

    if (ext === 'pdf') {
      detectedCategory = t('ingestion.categoryPdf')
      initialPipeline = 'Pipeline: PDF Fast-Router & Layout Extraction'
      ocrTech = useVisionOcr ? `PyMuPDF / Vision LLM OCR (${visionModelName}) + RapidOCR fallback` : 'PyMuPDF / RapidOCR (CUDA nativo)'
    } else if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) {
      detectedCategory = t('ingestion.categoryImage')
      initialPipeline = useVisionOcr ? 'Pipeline: Multimodal Vision & OCR' : 'Pipeline: RapidOCR Layout'
      ocrTech = useVisionOcr ? `Vision LLM OCR (${visionModelName}) + RapidOCR fallback` : 'RapidOCR (CUDA nativo)'
    } else if (ext === 'docx') {
      detectedCategory = t('ingestion.categoryWord')
      initialPipeline = 'Pipeline: DOCX Structured XML Parser'
      ocrTech = 'Structured Table & Heading Extraction'
    } else if (['csv', 'tsv', 'json'].includes(ext)) {
      detectedCategory = t('ingestion.categoryTabular')
      initialPipeline = 'Pipeline: Tabular Markdown Transformer'
      ocrTech = 'Structured Matrix & JSON Parser'
    } else {
      detectedCategory = t('ingestion.categorySource')
      initialPipeline = 'Pipeline: Direct Stream Sanitizer (NFC/UTF-8)'
      ocrTech = 'UTF-8 Control Character Sanitizer'
    }

    setIngestionProgress({
      active: true,
      taskId,
      fileName: baseName,
      fileCategory: detectedCategory,
      pipeline: initialPipeline,
      modelName: useVisionOcr ? visionModelName : 'RapidOCR PP-OCRv4',
      ocrTechnology: ocrTech,
      step: t('ingestion.stepPreprocessing'),
      percent: 20,
    })

    try {
      if (activeTaskIdRef.current !== taskId) return
      setIngestionProgress((p) => ({
        ...p,
        step: t('ingestion.stepExtracting', { technology: ocrTech }),
        percent: 55,
      }))

      const res = await apiService.ingestFile(
        targetFilePath,
        settings?.visionModel,
        visionPrompt,
        false,
        undefined,
        resolveModelContextLength(visionModelName, settings?.modelContextLengths, hardwareDefault, modelMetrics[visionModelName]?.contextLength),
        taskId,
        false,
      )

      if (activeTaskIdRef.current !== taskId) return

      if (!res.success) {
        setUploadError(res.error || t('ingestion.failedUnknown'))
        setIngestionProgress({ active: false, fileName: '', step: '', percent: 0 })
        return
      }

      setIngestionProgress((p) => ({
        ...p,
        pipeline: 'Pipeline: Vettorizzazione & Semantic Chunks LanceDB',
        modelName: settings?.embeddingModel || 'nomic-embed-text',
        step: t('ingestion.stepEmbedding', { model: settings?.embeddingModel || 'nomic-embed-text' }),
        percent: 85,
      }))

      notifyDocumentsChanged()
      await fetchDocuments()
      if (activeTaskIdRef.current !== taskId) return
      if (res.data) {
        primeDocumentMarkdown(res.data)
        handleSelectDoc(res.data)
      }

      setIngestionProgress({
        active: true,
        fileName: baseName,
        fileCategory: detectedCategory,
        pipeline: 'Pipeline: Ingestione & Re-indexing Completati',
        modelName: settings?.embeddingModel || 'nomic-embed-text',
        ocrTechnology: ocrTech,
        step: t('ingestion.stepCompleted'),
        percent: 100,
      })
      setTimeout(() => setIngestionProgress({ active: false, fileName: '', step: '', percent: 0 }), 2000)
    } catch (err: unknown) {
      if (activeTaskIdRef.current === taskId) {
        const normalized = normalizeError(err, 'Ingestion')
        setUploadError(normalized.remediation ? `${normalized.message} — ${normalized.remediation}` : normalized.message)
        setIngestionProgress({ active: false, fileName: '', step: '', percent: 0 })
      }
    } finally {
      if (activeTaskIdRef.current === taskId) {
        activeTaskIdRef.current = null
        setIsUploading(false)
      }
    }
  }

  const handleSelectFileNative = async () => {
    try {
      const selected = await apiService.openFileDialog({
        title: t('ingestion.selectFileTitle'),
        filters: [
          { name: t('ingestion.supportedDocuments'), extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'docx', 'txt', 'md'] },
          { name: t('ingestion.allFiles'), extensions: ['*'] },
        ],
      })
      if (selected && selected.length > 0) {
        for (const filePath of selected) {
          await handleIngestPath(filePath)
        }
      }
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'Native Dialog')
      logger.error('IngestionView', `Native file dialog error: ${normalized.message}`)
    }
  }

  const handleFileUpload = async (file: File) => {
    const filePath = (file as File & { path?: string }).path || file.name
    await handleIngestPath(filePath, file.name)
  }

  const handleSaveDocument = async () => {
    if (!selectedDoc || !markdownContent || loadedMarkdown === null || isSaving) return
    setIsSaving(true)
    setSaveStatus(null)

    try {
      const res = await apiService.updateIngestedDocument(selectedDoc.id, markdownContent)
      if (res.success && res.data) {
        primeDocumentMarkdown(res.data)
        editorSourceRef.current = { id: res.data.id, ingestedAt: res.data.ingestedAt, markdown: res.data.extractedMarkdown }
        setSelectedDoc({ ...selectedDoc, ...res.data })
        setMarkdownContent(res.data.extractedMarkdown)
        setSaveStatus({ success: true, message: t('ingestion.saveSuccess') })
        notifyDocumentsChanged()
        await fetchDocuments()
      } else {
        setSaveStatus({ success: false, message: res.error || t('ingestion.saveFailed') })
      }
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'Ingestion Save')
      setSaveStatus({ success: false, message: normalized.remediation ? `${normalized.message} — ${normalized.remediation}` : normalized.message })
    } finally {
      setIsSaving(false)
      setTimeout(() => {
        setSaveStatus(null)
      }, 4000)
    }
  }

  return {
    isPromptModalOpen,
    setIsPromptModalOpen,
    documents,
    selectedDoc,
    markdownContent,
    setMarkdownContent,
    isDirty,
    isSaving,
    saveStatus,
    handleSaveDocument,
    isUploading,
    uploadError,
    setUploadError,
    syncScroll,
    setSyncScroll,
    ingestionProgress,
    handleCancelIngestion,
    currentPage,
    scrollToPage,
    viewMode,
    setViewMode,
    zoomLevel,
    setZoomLevel,
    exportStatus,
    leftPaneRef,
    handleLeftPaneScroll,
    handleEditorDidMount,
    fetchDocuments,
    handleSelectDoc,
    handleDeleteDoc,
    handleFileUpload,
    handleIngestPath,
    handleSelectFileNative,
    handleExportMarkdown,
  }
}
