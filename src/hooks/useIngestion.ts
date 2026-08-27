import { useState, useEffect, useRef, useCallback } from 'react'
import { IngestedDocument, AppSettings, DiagnosticsData } from '../types'
import { apiService } from '../services/api'
import { logger } from '../lib/logger'
import { useIngestedDocuments, notifyDocumentsChanged } from './useIngestedDocuments'
import { useTranslation as useI18n } from '../i18n'
import { acquireGlobalTaskLock, releaseGlobalTaskLock, peekGlobalTaskLock } from '../services/globalTaskLock'
import { normalizeError } from '../lib/errors/errorNormalizer'
import { resolveNodeTemplate } from '../constants/promptConfig'
import { extractHardwareFacts } from '../services/hardwareRecommendationEngine'
import { resolveMaxContextTokens } from '../services/hardwareProfileTiers'
import { resolveModelContextLength } from '../../electron/core/domain/settings/modelContextPreference'

/**
 * The `images:analysis` template that goes on the wire, or `undefined` to stay on local RapidOCR.
 *
 * The multimodal engine is opt-in (Impostazioni > Motore OCR): sending the template is exactly what
 * tells the sidecar to route page bitmaps through the vision model. The template is shipped raw
 * because three of its four variables (`currentPage`, `numPages`, `activePageContent`) are only
 * known inside the sidecar's page loop, which renders it there.
 */
export function resolveVisionOcrPrompt(settings?: AppSettings): string | undefined {
  if (settings?.ocrEngine !== 'vision_model') return undefined
  return resolveNodeTemplate('images:analysis', settings).template || undefined
}

export interface IngestionProgressState {
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

export function useIngestion(settings?: AppSettings, diagnostics?: DiagnosticsData | null) {
  const hardwareDefault = resolveMaxContextTokens('Auto', extractHardwareFacts(diagnostics || null))
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
    if (isIngestionBusy) {
      acquireGlobalTaskLock('ingestion')
      return () => releaseGlobalTaskLock('ingestion')
    }
    releaseGlobalTaskLock('ingestion')
  }, [isIngestionBusy])

  const isDirty = selectedDoc !== null && markdownContent !== selectedDoc.extractedMarkdown

  const [ingestionProgress, setIngestionProgress] = useState<IngestionProgressState>({
    active: false,
    fileName: '',
    step: '',
    percent: 0,
  })

  const isCancelledRef = useRef<boolean>(false)

  const handleDocUpdateCallback = useCallback((docs: IngestedDocument[]) => {
    setSelectedDoc((prev) => {
      if (prev) {
        const updated = docs.find((d) => d.id === prev.id)
        if (updated) {
          setMarkdownContent((curr) => curr || updated.extractedMarkdown)
          return updated
        }
        // prev is no longer in docs (was deleted)
        if (docs.length > 0) {
          setMarkdownContent(docs[0].extractedMarkdown)
          return docs[0]
        }
        setMarkdownContent('')
        return null
      }
      if (docs.length > 0) {
        setMarkdownContent(docs[0].extractedMarkdown)
        return docs[0]
      }
      setMarkdownContent('')
      return null
    })
  }, [])

  const {
    documents,
    refetchDocuments: fetchDocuments,
  } = useIngestedDocuments({
    onDocsUpdated: handleDocUpdateCallback,
  })

  const handleCancelIngestion = async () => {
    isCancelledRef.current = true
    if (window.electronAPI?.cancelTask) {
      await window.electronAPI.cancelTask()
    }
    setIngestionProgress({ active: false, fileName: '', step: '', percent: 0 })
    setIsUploading(false)
    setUploadError('Ingestion cancelled by user. Temporary files and partial task data cleaned.')
  }

  // Real-time streaming progress subscription from Electron/FastAPI sidecar
  useEffect(() => {
    if (!window.electronAPI?.onIngestStreamProgress) return

    const unsubscribe = window.electronAPI.onIngestStreamProgress((payload) => {
      if (isCancelledRef.current) return
      if (payload.type === 'progress') {
        setIngestionProgress((prev) => ({
          ...prev,
          active: true,
          fileName: payload.fileName || prev.fileName,
          step: payload.step || prev.step,
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
          step: 'Ingestione e indicizzazione completate con successo!',
          percent: 100,
          pipeline: 'Completato',
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
  const editorRef = useRef<any>(null)
  const isSyncingScrollRef = useRef<boolean>(false)

  const scrollToPage = useCallback((targetPage: number) => {
    setCurrentPage(targetPage)

    if (editorRef.current && markdownContent) {
      const targetLine = getPageLineNumber(markdownContent, targetPage)
      editorRef.current.revealLineNearTop(targetLine)
      editorRef.current.setPosition({ lineNumber: targetLine, column: 1 })
    }

    if (viewMode === 'page' && leftPaneRef.current) {
      leftPaneRef.current.scrollTop = 0
    } else if (viewMode === 'all' && leftPaneRef.current) {
      // Match by data-page-number (set by every page card, image-backed or text-fallback alike)
      // rather than a fixed id -- SourcePagePreview only renders a `rendered-page-N` id for the
      // no-scanned-image fallback case, so an id lookup silently no-ops for image-backed pages.
      const targetElem = leftPaneRef.current.querySelector<HTMLElement>(`[data-page-number="${targetPage}"]`)
      if (targetElem) {
        const offset = targetElem.offsetTop - leftPaneRef.current.offsetTop
        leftPaneRef.current.scrollTo({ top: Math.max(0, offset - 10), behavior: 'smooth' })
      }
    }
  }, [markdownContent, viewMode])

  const handleLeftPaneScroll = () => {
    if (!syncScroll || isSyncingScrollRef.current || !leftPaneRef.current || !editorRef.current) return
    isSyncingScrollRef.current = true

    const { scrollTop, scrollHeight, clientHeight } = leftPaneRef.current
    const maxScroll = scrollHeight - clientHeight

    if (viewMode === 'all') {
      // Scroll spy: identify visible page card
      const pageElements = leftPaneRef.current.querySelectorAll('[data-page-number]')
      pageElements.forEach((el) => {
        const rect = el.getBoundingClientRect()
        const parentRect = leftPaneRef.current!.getBoundingClientRect()
        if (rect.top <= parentRect.top + 100 && rect.bottom >= parentRect.top + 100) {
          const pageNum = Number(el.getAttribute('data-page-number'))
          if (pageNum && pageNum !== currentPage) {
            setCurrentPage(pageNum)
          }
        }
      })

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
  }

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor
    editor.onDidScrollChange((e: any) => {
      if (!syncScroll || isSyncingScrollRef.current || !leftPaneRef.current) return
      if (!e.scrollTopChanged) return

      isSyncingScrollRef.current = true
      const editorScrollHeight = editor.getScrollHeight()
      const editorLayout = editor.getLayoutInfo()
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
    setSelectedDoc(doc)
    setMarkdownContent(doc.extractedMarkdown)
    setCurrentPage(1)
    setExportStatus(null)
  }

  const handleDeleteDoc = async (id: string, filename?: string) => {
    try {
      await apiService.deleteIngestedDocument(id)
      notifyDocumentsChanged()
      if (selectedDoc?.id === id) {
        const remaining = documents.filter((d) => d.id !== id)
        if (remaining.length > 0) {
          handleSelectDoc(remaining[0])
        } else {
          setSelectedDoc(null)
          setMarkdownContent('')
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
      const message = busyModule === 'coding'
        ? t('common.crossModuleTaskBlocked', { module: t('common.moduleNameCoding') })
        : t('common.crossModuleTaskBlocked', { module: t('common.moduleNameTranslation') })
      setUploadError(message)
      return
    }

    isCancelledRef.current = false
    setIsUploading(true)
    setUploadError(null)

    const baseName = displayName || targetFilePath.split(/[/\\]/).pop() || targetFilePath
    const ext = baseName.includes('.') ? baseName.split('.').pop()!.toLowerCase() : 'text'

    const visionPrompt = resolveVisionOcrPrompt(settings)
    const useVisionOcr = visionPrompt !== undefined
    const visionModelName = settings?.visionModel || 'llama3.2-vision'

    let detectedCategory = 'Documento Testo'
    let initialPipeline = 'Fast-Router: Pre-analisi & Classificazione'
    let ocrTech = 'PyMuPDF Text Extraction'

    if (ext === 'pdf') {
      detectedCategory = 'PDF (Ibrido / Scansione / Testo)'
      initialPipeline = 'Pipeline: PDF Fast-Router & Layout Extraction'
      ocrTech = useVisionOcr
        ? `PyMuPDF / Vision LLM OCR (${visionModelName}) + RapidOCR fallback`
        : 'PyMuPDF / RapidOCR (CUDA nativo)'
    } else if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) {
      detectedCategory = 'Immagine Raster'
      initialPipeline = useVisionOcr ? 'Pipeline: Multimodal Vision & OCR' : 'Pipeline: RapidOCR Layout'
      ocrTech = useVisionOcr
        ? `Vision LLM OCR (${visionModelName}) + RapidOCR fallback`
        : 'RapidOCR (CUDA nativo)'
    } else if (ext === 'docx') {
      detectedCategory = 'Microsoft Word'
      initialPipeline = 'Pipeline: DOCX Structured XML Parser'
      ocrTech = 'Structured Table & Heading Extraction'
    } else if (['csv', 'tsv', 'json'].includes(ext)) {
      detectedCategory = 'Dati Tabellari / Strutturati'
      initialPipeline = 'Pipeline: Tabular Markdown Transformer'
      ocrTech = 'Structured Matrix & JSON Parser'
    } else {
      detectedCategory = 'File Testo / Codice Sorgente'
      initialPipeline = 'Pipeline: Direct Stream Sanitizer (NFC/UTF-8)'
      ocrTech = 'UTF-8 Control Character Sanitizer'
    }

    setIngestionProgress({
      active: true,
      fileName: baseName,
      fileCategory: detectedCategory,
      pipeline: initialPipeline,
      modelName: useVisionOcr ? visionModelName : 'RapidOCR PP-OCRv4',
      ocrTechnology: ocrTech,
      step: 'Pre-elaborazione, Fast-Routing e classificazione del file...',
      percent: 20,
    })

    try {
      if (isCancelledRef.current) return
      setIngestionProgress((p) => ({
        ...p,
        step: `Estrazione Layout & OCR in corso (${ocrTech})...`,
        percent: 55,
      }))

      const res = await apiService.ingestFile(
        targetFilePath,
        settings?.visionModel,
        visionPrompt,
        false,
        undefined,
        resolveModelContextLength(visionModelName, settings?.modelContextLengths, hardwareDefault)
      )

      if (isCancelledRef.current) return

      if (!res.success) {
        setUploadError(res.error || 'Ingestion failed: unknown error from sidecar engine')
        setIngestionProgress({ active: false, fileName: '', step: '', percent: 0 })
        return
      }

      setIngestionProgress((p) => ({
        ...p,
        pipeline: 'Pipeline: Vettorizzazione & Semantic Chunks LanceDB',
        modelName: settings?.embeddingModel || 'nomic-embed-text',
        step: `Generazione embeddings con ${settings?.embeddingModel || 'nomic-embed-text'} & indicizzazione FTS BM25...`,
        percent: 85,
      }))

      notifyDocumentsChanged()
      await fetchDocuments()
      if (res.data) {
        handleSelectDoc(res.data)
      }

      setIngestionProgress({
        active: true,
        fileName: baseName,
        fileCategory: detectedCategory,
        pipeline: 'Pipeline: Ingestione & Re-indexing Completati',
        modelName: settings?.embeddingModel || 'nomic-embed-text',
        ocrTechnology: ocrTech,
        step: 'Ingestione e indicizzazione completate con successo!',
        percent: 100,
      })
      setTimeout(() => setIngestionProgress({ active: false, fileName: '', step: '', percent: 0 }), 2000)
    } catch (err: any) {
      if (!isCancelledRef.current) {
        const normalized = normalizeError(err, 'Ingestion')
        setUploadError(normalized.remediation ? `${normalized.message} — ${normalized.remediation}` : normalized.message)
        setIngestionProgress({ active: false, fileName: '', step: '', percent: 0 })
      }
    } finally {
      setIsUploading(false)
    }
  }

  const handleSelectFileNative = async () => {
    try {
      const selected = await apiService.openFileDialog({
        title: 'Seleziona Documento per Ingestion & OCR',
        filters: [
          { name: 'Documenti Supportati', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'docx', 'txt', 'md'] },
          { name: 'Tutti i file', extensions: ['*'] },
        ],
      })
      if (selected && selected.length > 0) {
        for (const filePath of selected) {
          await handleIngestPath(filePath)
        }
      }
    } catch (err: any) {
      const normalized = normalizeError(err, 'Native Dialog')
      logger.error('IngestionView', `Native file dialog error: ${normalized.message}`)
    }
  }

  const handleFileUpload = async (file: File) => {
    const filePath = (file as any).path || file.name
    await handleIngestPath(filePath, file.name)
  }

  const handleSaveDocument = async () => {
    if (!selectedDoc || !markdownContent || isSaving) return
    setIsSaving(true)
    setSaveStatus(null)

    try {
      const res = await apiService.updateIngestedDocument(selectedDoc.id, markdownContent)
      if (res.success && res.data) {
        setSelectedDoc(res.data)
        setMarkdownContent(res.data.extractedMarkdown)
        setSaveStatus({ success: true, message: 'Modifiche salvate e vettori LanceDB ri-indicizzati con successo!' })
        notifyDocumentsChanged()
        await fetchDocuments()
      } else {
        setSaveStatus({ success: false, message: res.error || 'Errore durante il salvataggio del documento' })
      }
    } catch (err: any) {
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
