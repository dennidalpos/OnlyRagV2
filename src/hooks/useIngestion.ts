import { useState, useEffect, useRef, useCallback } from 'react'
import { IngestedDocument, AppSettings } from '../types'
import { apiService } from '../services/api'
import { logger } from '../lib/logger'
import { useIngestedDocuments, notifyDocumentsChanged } from './useIngestedDocuments'

export interface InspectorMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
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

export function useIngestion(settings?: AppSettings) {
  const [isPromptModalOpen, setIsPromptModalOpen] = useState<boolean>(false)
  const [selectedDoc, setSelectedDoc] = useState<IngestedDocument | null>(null)
  const [markdownContent, setMarkdownContent] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [isUploading, setIsUploading] = useState<boolean>(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [syncScroll, setSyncScroll] = useState<boolean>(true)
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [saveStatus, setSaveStatus] = useState<{ success: boolean; message: string } | null>(null)

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
      }
      if (docs.length > 0 && !prev) {
        setMarkdownContent(docs[0].extractedMarkdown)
        return docs[0]
      }
      if (docs.length === 0) {
        setMarkdownContent('')
        return null
      }
      return prev
    })
  }, [])

  const {
    documents,
    isLoading: isDocsLoading,
    refetchDocuments: fetchDocuments,
  } = useIngestedDocuments({
    onDocsUpdated: handleDocUpdateCallback,
    autoRetryIntervalMs: 3000,
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

  const [docSearchQuery, setDocSearchQuery] = useState<string>('')
  const [activeMatchIndex, setActiveMatchIndex] = useState<number>(0)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [viewMode, setViewMode] = useState<'page' | 'all'>('page')
  const [zoomLevel, setZoomLevel] = useState<number>(100)

  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(false)
  const [inspectorMessages, setInspectorMessages] = useState<InspectorMessage[]>([])
  const [inspectorInput, setInspectorInput] = useState<string>('')
  const [isAnalyzingDiagram, setIsAnalyzingDiagram] = useState<boolean>(false)
  const [streamingText, setStreamingText] = useState<string>('')
  const [exportStatus, setExportStatus] = useState<{ active: boolean; message: string; isError?: boolean } | null>(null)
  const chatBottomRef = useRef<HTMLDivElement>(null)
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
    } else if (viewMode === 'all') {
      const targetElem = document.getElementById(`rendered-page-${targetPage}`)
      if (targetElem && leftPaneRef.current) {
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
    setExportStatus({ active: true, message: `Preparazione esportazione ${format.toUpperCase()} in corso...` })
    try {
      const res = await apiService.exportDocument(markdownContent, format)
      if (res.success) {
        setExportStatus({ active: false, message: res.message || `Documento ${format.toUpperCase()} esportato con successo!` })
      } else {
        setExportStatus({ active: false, message: res.error || res.message || 'Esportazione annullata.', isError: true })
      }
    } catch (err: any) {
      setExportStatus({ active: false, message: `Errore esportazione: ${err.message}`, isError: true })
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
    setDocSearchQuery('')
    setActiveMatchIndex(0)
    setInspectorMessages([])
    setIsInspectorOpen(false)
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
    } catch (err: any) {
      logger.error('IngestionView', `Error deleting document ${id}: ${err.message}`)
    }
  }

  const handleIngestPath = async (targetFilePath: string, displayName?: string) => {
    if (!targetFilePath || !targetFilePath.trim()) return
    isCancelledRef.current = false
    setIsUploading(true)
    setUploadError(null)

    const baseName = displayName || targetFilePath.split(/[/\\]/).pop() || targetFilePath
    const ext = baseName.includes('.') ? baseName.split('.').pop()!.toLowerCase() : 'text'

    let detectedCategory = 'Documento Testo'
    let initialPipeline = 'Fast-Router: Pre-analisi & Classificazione'
    let ocrTech = 'Docling Layout / PyMuPDF OCR'

    if (ext === 'pdf') {
      detectedCategory = 'PDF (Ibrido / Scansione / Testo)'
      initialPipeline = 'Pipeline: PDF Fast-Router & Layout Extraction'
      ocrTech = `PyMuPDF / Docling Layout + VLM (${settings?.visionModel || 'llama3.2-vision'})`
    } else if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) {
      detectedCategory = 'Immagine Raster'
      initialPipeline = 'Pipeline: Multimodal Vision & OCR'
      ocrTech = `Ollama Vision (${settings?.visionModel || 'llama3.2-vision'}) / EasyOCR`
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
      modelName: settings?.visionModel || 'llama3.2-vision',
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

      const res = await apiService.ingestFile(targetFilePath)

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
        setUploadError(err.message || 'Error ingesting file')
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
      logger.error('IngestionView', `Native file dialog error: ${err.message}`)
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
      setSaveStatus({ success: false, message: err.message || 'Eccezione salvataggio documento' })
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
    searchQuery,
    setSearchQuery,
    isUploading,
    isDocsLoading,
    uploadError,
    syncScroll,
    setSyncScroll,
    ingestionProgress,
    handleCancelIngestion,
    docSearchQuery,
    setDocSearchQuery,
    activeMatchIndex,
    setActiveMatchIndex,
    currentPage,
    setCurrentPage,
    scrollToPage,
    viewMode,
    setViewMode,
    zoomLevel,
    setZoomLevel,
    isInspectorOpen,
    setIsInspectorOpen,
    inspectorMessages,
    setInspectorMessages,
    inspectorInput,
    setInspectorInput,
    isAnalyzingDiagram,
    setIsAnalyzingDiagram,
    streamingText,
    setStreamingText,
    chatBottomRef,
    exportStatus,
    leftPaneRef,
    editorRef,
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
