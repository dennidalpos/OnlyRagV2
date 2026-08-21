import React, { useRef, useMemo, useEffect, useState } from 'react'
import Editor from '@monaco-editor/react'
import { AppSettings } from '../../types'
import {
  FileText,
  Upload,
  Eye,
  Download,
  RefreshCw,
  Link,
  Sliders,
  Loader2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Layers,
  Sparkles,
  Save,
  CheckCircle2,
  Copy,
  Check,
  GripVertical,
  WrapText,
} from 'lucide-react'
import { SystemPromptModal } from '../common/SystemPromptModal'
import { ModelBadge } from '../common/ModelBadge'
import { DocumentListTable } from './DocumentListTable'
import { VectorSearchPanel } from './VectorSearchPanel'
import { SourcePagePreview } from './SourcePagePreview'
import { TranslateInplaceModal } from './TranslateInplaceModal'
import { useIngestion } from '../../hooks/useIngestion'
import { useToast } from '../common/Toast'
import { useTranslation } from '../../i18n'
import { useResizablePanel } from '../../hooks/useResizablePanel'
import { IngestedDocument } from '../../types'

interface IngestionViewProps {
  settings?: AppSettings
  onUpdateSettings?: (newSettings: Partial<AppSettings>) => void
}

export const IngestionView: React.FC<IngestionViewProps> = ({ settings, onUpdateSettings }) => {
  const { t } = useTranslation()
  const ing = useIngestion(settings)
  const toast = useToast()
  const {
    width: sidebarWidth,
    isResizing: isSidebarResizing,
    handleMouseDown: handleSidebarMouseDown,
    handleKeyDown: handleSidebarKeyDown,
  } = useResizablePanel(320, 220, 550, 'onlyrag_ingestion_sidebar_width')
  const initialPreviewWidth = typeof window !== 'undefined'
    ? Math.max(300, Math.min(Math.round((window.innerWidth - 320) * 0.48), 900))
    : 450
  const {
    width: previewWidth,
    isResizing: isPreviewResizing,
    handleMouseDown: handlePreviewMouseDown,
    handleKeyDown: handlePreviewKeyDown,
  } = useResizablePanel(initialPreviewWidth, 250, 950, 'onlyrag_ingestion_preview_width')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const dragCounterRef = useRef<number>(0)
  const [copiedMarkdown, setCopiedMarkdown] = useState(false)
  const [translateInplaceDoc, setTranslateInplaceDoc] = useState<IngestedDocument | null>(null)

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current += 1
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingOver(true)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDraggingOver(false)
    const files = e.dataTransfer.files
    if (!files || files.length === 0) return

    if (files.length > 1) {
      toast.info(`Caricamento di ${files.length} file in sequenza...`)
    }
    // Sequential, matching handleSelectFileNative: ingestion isn't safe to run concurrently
    // for multiple files (shared upload/progress state in useIngestion).
    for (let i = 0; i < files.length; i++) {
      await ing.handleFileUpload(files[i])
    }
  }

  // Listen for Ctrl+S / Cmd+S shortcut to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (ing.isDirty && !ing.isSaving) {
          ing.handleSaveDocument()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [ing.isDirty, ing.isSaving, ing.handleSaveDocument])

  // Parse markdown into distinct paginated sections robustly
  const parsedPages = useMemo(() => {
    if (!ing.selectedDoc || !ing.markdownContent) return []
    const text = ing.markdownContent.trim()
    if (!text) return []

    const pageSplitRegex = /(?:^|\n)(?=## Page \d+|## Image)/i
    const rawParts = text.split(pageSplitRegex).map((p) => p.trim()).filter(Boolean)

    if (rawParts.length > 0 && rawParts.some((p) => /^## (?:Page \d+|Image)/i.test(p))) {
      let docTitlePreamble = ''
      const validPages: { pageNumber: number; content: string }[] = []

      for (let i = 0; i < rawParts.length; i++) {
        const part = rawParts[i]
        if (!/^## (?:Page \d+|Image)/i.test(part) && i === 0) {
          docTitlePreamble = part
        } else {
          const pageIndex = validPages.length + 1
          const content = validPages.length === 0 && docTitlePreamble
            ? `${docTitlePreamble}\n\n${part}`
            : part
          validPages.push({ pageNumber: pageIndex, content })
        }
      }

      if (validPages.length > 0) {
        return validPages
      }
    }

    const hrParts = text.split(/\n---\n/).map((p) => p.trim()).filter(Boolean)
    if (hrParts.length > 1) {
      return hrParts.map((part, idx) => ({ pageNumber: idx + 1, content: part }))
    }

    return [{ pageNumber: 1, content: text }]
  }, [ing.selectedDoc, ing.markdownContent])

  const totalPages = Math.max(1, parsedPages.length || ing.selectedDoc?.numPages || 1)
  const activePageNum = Math.min(Math.max(1, ing.currentPage), totalPages)

  const activePageData = parsedPages.find((p) => p.pageNumber === activePageNum) || parsedPages[0] || {
    pageNumber: 1,
    content: ing.markdownContent,
  }

  const handlePrevPage = () => {
    if (ing.currentPage > 1) {
      ing.scrollToPage(ing.currentPage - 1)
    }
  }

  const handleNextPage = () => {
    if (ing.currentPage < totalPages) {
      ing.scrollToPage(ing.currentPage + 1)
    }
  }

  // Mouse-wheel page turning in single-page mode: continuing to scroll past the top/bottom
  // edge of the current page (like a PDF viewer) advances to the prev/next page instead of
  // doing nothing. The cooldown prevents one continuous wheel gesture from skipping several
  // pages, since a single scroll motion fires many wheel events in quick succession.
  const wheelPageCooldownRef = useRef<number>(0)
  const handlePreviewWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (ing.viewMode !== 'page') return
    const el = ing.leftPaneRef.current
    if (!el || e.deltaY === 0) return

    const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= 2
    const atTop = el.scrollTop <= 2
    const canAdvance = e.deltaY > 0 && atBottom && ing.currentPage < totalPages
    const canRewind = e.deltaY < 0 && atTop && ing.currentPage > 1
    if (!canAdvance && !canRewind) return

    const now = Date.now()
    if (now - wheelPageCooldownRef.current < 500) return
    wheelPageCooldownRef.current = now

    if (canAdvance) handleNextPage()
    else handlePrevPage()
  }

  const handleZoomIn = () => {
    ing.setZoomLevel(Math.min(150, ing.zoomLevel + 10))
  }

  const handleZoomOut = () => {
    ing.setZoomLevel(Math.max(70, ing.zoomLevel - 10))
  }

  const handleZoomReset = () => {
    ing.setZoomLevel(100)
  }

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex-1 h-full flex flex-col bg-slate-950 overflow-hidden select-text relative"
    >
      {/* Drag & Drop Visual Overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 z-50 bg-slate-950/90 backdrop-blur-sm border-2 border-dashed border-cyan-400 flex flex-col items-center justify-center p-8 transition-all animate-in fade-in pointer-events-none">
          <div className="w-16 h-16 rounded-3xl bg-cyan-500/20 border border-cyan-400 flex items-center justify-center text-cyan-400 mb-4 shadow-xl shadow-cyan-950/50">
            <Upload className="w-8 h-8 animate-bounce" />
          </div>
          <div className="text-lg font-bold text-slate-100">{t('ingestion.dropzoneRelease')}</div>
          <p className="text-xs text-slate-400 mt-1 max-w-sm text-center">
            {t('ingestion.dropzoneSupportedFormats')}
          </p>
        </div>
      )}

      {/* Header Bar */}
      <div className="p-4 border-b border-slate-800 bg-slate-900/80 flex items-center justify-between z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
            <FileText className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="font-bold text-slate-100 text-sm tracking-wide">{t('navigation.ingestion')}</h1>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Active Chat RAG & Text Check Model Badge */}
          <ModelBadge
            modelName={settings?.chatModel || settings?.defaultModel || 'llama3.2'}
            tier={settings?.normalizeWithLlm ? "heavy" : "standard"}
            tierName={settings?.normalizeWithLlm ? "Text Check (Chat RAG)" : "Chat RAG"}
            tooltip={t('ingestion.textCheckTooltip', { model: settings?.chatModel || settings?.defaultModel || 'llama3.2' })}
          />

          {/* Active Vision Model Badge */}
          {settings?.visionModel && (
            <ModelBadge
              modelName={settings.visionModel}
              tier="fast"
              tierName="Vision"
              tooltip={`Vision & OCR: ${settings.visionModel}`}
            />
          )}

          {/* Optional LLM Text Check Toggle */}
          <button
            type="button"
            onClick={() => onUpdateSettings?.({ normalizeWithLlm: !settings?.normalizeWithLlm })}
            aria-label={t('ingestion.textCheckToggle')}
            title={t('ingestion.textCheckTooltip', { model: settings?.chatModel || settings?.defaultModel || 'llama3.2' })}
            className={`px-3 py-1.5 border text-xs font-semibold rounded-xl transition-all focus-ring flex items-center gap-1.5 active:scale-95 ${
              settings?.normalizeWithLlm
                ? 'bg-emerald-950/80 hover:bg-emerald-900 border-emerald-700/80 text-emerald-300 shadow-sm'
                : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className={`w-3.5 h-3.5 ${settings?.normalizeWithLlm ? 'text-emerald-400 animate-pulse' : 'text-slate-400'}`} />
            <span>{t('ingestion.textCheckToggle')}</span>
          </button>

          <button
            type="button"
            onClick={() => ing.setIsPromptModalOpen(true)}
            aria-label={t('chat.configurePrompt')}
            title={t('chat.configurePrompt')}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/50 text-cyan-300 text-xs font-semibold rounded-xl transition-all focus-ring flex items-center gap-1.5 active:scale-95"
          >
            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">{t('chat.configurePrompt')}</span>
          </button>

          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) ing.handleFileUpload(e.target.files[0])
              if (fileInputRef.current) fileInputRef.current.value = ''
            }}
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.docx,.txt,.md,.csv,.tsv,.json"
          />

          <button
            type="button"
            onClick={ing.handleSelectFileNative}
            disabled={ing.isUploading}
            aria-label={ing.isUploading ? t('common.loading') : t('ingestion.uploadButton')}
            className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold text-xs rounded-xl transition-all focus-ring flex items-center gap-2 shadow-lg shadow-cyan-950/40 active:scale-95"
          >
            {ing.isUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                <span>{t('common.loading')}</span>
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                <span>{t('ingestion.uploadButton')}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Ingestion Progress Bar with Pipeline, Models & OCR Tech Badges */}
      {ing.ingestionProgress.active && (
        <div className="px-4 py-3.5 bg-slate-900/95 border-b border-cyan-500/20 shrink-0 space-y-2.5 shadow-lg shadow-cyan-950/20">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-slate-100 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400 shrink-0" />
                <span className="truncate max-w-xs" title={ing.ingestionProgress.fileName}>
                  {ing.ingestionProgress.fileName}
                </span>
                {ing.ingestionProgress.fileCategory && (
                  <span className="text-[10px] text-cyan-300 font-mono font-normal">
                    ({ing.ingestionProgress.fileCategory})
                  </span>
                )}
              </div>

              {/* Pipeline Badge */}
              {ing.ingestionProgress.pipeline && (
                <span className="px-2 py-0.5 rounded-lg bg-cyan-950/80 border border-cyan-800 text-cyan-300 text-[11px] font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                  <span>{ing.ingestionProgress.pipeline}</span>
                </span>
              )}

              {/* OCR Technology Badge */}
              {ing.ingestionProgress.ocrTechnology && (
                <span className="px-2 py-0.5 rounded-lg bg-sky-950/70 border border-sky-800 text-sky-300 text-[11px] font-medium flex items-center gap-1">
                  <span className="text-sky-400 font-bold">OCR:</span>
                  <span>{ing.ingestionProgress.ocrTechnology}</span>
                </span>
              )}

              {/* Active Model Badge */}
              {ing.ingestionProgress.modelName && (
                <span className="px-2 py-0.5 rounded-lg bg-indigo-950/70 border border-indigo-800 text-indigo-300 text-[11px] font-mono flex items-center gap-1">
                  <span className="text-indigo-400 font-bold">Modello:</span>
                  <span>{ing.ingestionProgress.modelName}</span>
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={ing.handleCancelIngestion}
              aria-label={t('ingestion.cancelOperation')}
              className="px-2.5 py-1 bg-rose-950/60 hover:bg-rose-900/80 border border-rose-800/50 text-rose-300 text-[11px] font-semibold rounded-lg transition-colors flex items-center gap-1.5 shrink-0 focus-ring active:scale-95"
            >
              <AlertTriangle className="w-3.5 h-3.5" /> {t('common.cancel')}
            </button>
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-0.5">
            <span className="text-cyan-300/90 font-sans font-medium">{ing.ingestionProgress.step}</span>
            <span className="text-cyan-400 font-bold font-mono">{ing.ingestionProgress.percent}%</span>
          </div>

          <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 via-sky-400 to-indigo-400 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${ing.ingestionProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Save Status Notification Banner */}
      {ing.saveStatus && (
        <div
          role="status"
          className={`px-4 py-2.5 border-b flex items-center justify-between text-xs font-semibold shrink-0 transition-all ${
            ing.saveStatus.success
              ? 'bg-emerald-950/80 border-emerald-800 text-emerald-300 shadow-md shadow-emerald-950/40'
              : 'bg-rose-950/80 border-rose-800 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {ing.saveStatus.success ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            )}
            <span>{ing.saveStatus.message}</span>
          </div>
        </div>
      )}

      {/* Translate In-Place Status Notification Banner */}
      {ing.translateInplaceStatus && (
        <div
          role="status"
          className={`px-4 py-2.5 border-b flex items-center justify-between text-xs font-semibold shrink-0 transition-all ${
            ing.translateInplaceStatus.success
              ? 'bg-emerald-950/80 border-emerald-800 text-emerald-300 shadow-md shadow-emerald-950/40'
              : 'bg-rose-950/80 border-rose-800 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {ing.translateInplaceStatus.success ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            )}
            <span>{ing.translateInplaceStatus.message}</span>
          </div>
        </div>
      )}

      {/* Export Status Notification Banner */}
      {ing.exportStatus && (
        <div
          role="status"
          className={`px-4 py-2.5 border-b flex items-center justify-between text-xs font-semibold shrink-0 transition-all ${
            ing.exportStatus.isError
              ? 'bg-rose-950/80 border-rose-800 text-rose-300'
              : 'bg-emerald-950/80 border-emerald-800 text-emerald-300 shadow-md shadow-emerald-950/40'
          }`}
        >
          <div className="flex items-center gap-2">
            {ing.exportStatus.active ? (
              <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
            ) : ing.exportStatus.isError ? (
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            ) : (
              <Download className="w-4 h-4 text-emerald-400" />
            )}
            <span>{ing.exportStatus.message}</span>
          </div>
        </div>
      )}

      {/* Upload Error Alert */}
      {ing.uploadError && !ing.ingestionProgress.active && (
        <div className="mx-4 mt-3 p-3 bg-rose-950/50 border border-rose-800/60 rounded-xl flex items-start gap-2.5 shrink-0" role="alert">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-xs font-semibold text-rose-300">{t('ingestion.ingestionError')}</div>
            <div className="text-[11px] text-rose-400/80 mt-0.5 font-mono">{ing.uploadError}</div>
          </div>
        </div>
      )}

      {/* Main Dual-Pane Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar: Document List & LanceDB Vector Search */}
        <div
          style={{ width: `${sidebarWidth}px` }}
          className="border-r border-slate-800 bg-slate-900/40 p-4 space-y-4 flex flex-col shrink-0 overflow-hidden select-text"
        >
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
              <span>{t('ingestion.indexedDocuments')} ({ing.documents.length})</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/70 border border-cyan-800/80 text-cyan-300 font-normal">
                LanceDB
              </span>
            </div>
            <button
              type="button"
              onClick={ing.fetchDocuments}
              aria-label={t('common.refresh')}
              title={t('common.refresh')}
              className="p-1.5 text-slate-400 hover:text-cyan-400 transition-colors rounded-lg focus-ring active:scale-95"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          <DocumentListTable
            documents={ing.documents}
            selectedDoc={ing.selectedDoc}
            onSelectDoc={ing.handleSelectDoc}
            onDeleteDoc={(docId: string, filename: string) => ing.handleDeleteDoc(docId, filename)}
            onTranslateInplace={(doc) => setTranslateInplaceDoc(doc)}
          />

          <VectorSearchPanel embeddingModel={settings?.embeddingModel} />
        </div>

        {/* Resizable Sidebar Divider Handle */}
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-valuenow={sidebarWidth}
          aria-valuemin={220}
          aria-valuemax={550}
          aria-label={t('coding.resizePanels')}
          onMouseDown={handleSidebarMouseDown}
          onKeyDown={handleSidebarKeyDown}
          className={`w-1.5 hover:w-2 hover:bg-cyan-500 bg-slate-800/80 cursor-col-resize transition-all shrink-0 flex items-center justify-center group focus-ring ${
            isSidebarResizing ? 'bg-cyan-500 w-2 ring-2 ring-cyan-500/50' : ''
          }`}
          title={t('coding.resizePanels')}
        >
          <GripVertical className={`w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity ${isSidebarResizing ? 'opacity-100 text-slate-950' : ''}`} />
        </div>

        {/* Center: Dual-Pane Comparison Viewer */}
        <div className={`flex-1 flex flex-col overflow-hidden ${isSidebarResizing ? 'pointer-events-none select-none' : ''}`}>
          {/* Dual-Pane Header & Pagination Toolbar */}
          <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
            {/* Left: Selected Document Name & Dirty State Status */}
            <div className="flex items-center gap-3 text-slate-200 font-semibold truncate max-w-sm">
              <Eye className="w-4 h-4 text-cyan-400 shrink-0" />
              <span className="truncate" title={ing.selectedDoc?.filename || ''}>
                {ing.selectedDoc ? ing.selectedDoc.filename : t('ingestion.noDocumentSelected')}
              </span>
              {ing.selectedDoc && (
                <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] text-cyan-300 font-mono">
                  {totalPages} {t('ingestion.pages').toLowerCase()}
                </span>
              )}
              {ing.selectedDoc && (
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono flex items-center gap-1.5 border transition-all ${
                    ing.isDirty
                      ? 'bg-amber-950/80 border-amber-800/80 text-amber-300 animate-pulse'
                      : 'bg-emerald-950/60 border-emerald-800/60 text-emerald-400'
                  }`}
                  title={ing.isDirty ? `${t('ingestion.unsavedChanges')} (Ctrl+S)` : t('ingestion.synchronized')}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${ing.isDirty ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                  <span>{ing.isDirty ? t('ingestion.unsavedChanges') : t('ingestion.synchronized')}</span>
                </span>
              )}
            </div>

            {/* Center: Pagination & View Mode Controls */}
            {ing.selectedDoc && (
              <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-800 rounded-xl p-1 shadow-inner">
                <button
                  type="button"
                  onClick={handlePrevPage}
                  disabled={ing.currentPage <= 1 || ing.viewMode === 'all'}
                  aria-label={t('common.back')}
                  title={t('common.back')}
                  className="p-1.5 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 rounded-lg transition-colors focus-ring"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                {ing.viewMode === 'page' ? (
                  <div className="flex items-center gap-1.5 px-2 font-mono text-xs text-slate-200">
                    <span>{t('ingestion.singlePage')}</span>
                    <select
                      value={activePageNum}
                      onChange={(e) => ing.scrollToPage(Number(e.target.value))}
                      aria-label={t('ingestion.pageNavigation')}
                      className="bg-slate-900 border border-slate-700 rounded-md px-2 py-0.5 text-cyan-300 font-bold outline-none text-xs focus-ring font-mono"
                    >
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                    <span>/ {totalPages}</span>
                  </div>
                ) : (
                  <span className="px-2 font-mono text-[11px] text-cyan-300 font-semibold">{t('ingestion.allPages')} ({totalPages})</span>
                )}

                <button
                  type="button"
                  onClick={handleNextPage}
                  disabled={ing.currentPage >= totalPages || ing.viewMode === 'all'}
                  aria-label={t('common.next')}
                  title={t('common.next')}
                  className="p-1.5 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 rounded-lg transition-colors focus-ring"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>

                <div className="w-[1px] h-4 bg-slate-800 mx-1" />

                {/* Single Page vs Continuous Mode Toggle */}
                <div className="flex items-center gap-1" role="group" aria-label={t('ingestion.pageViewMode')}>
                  <button
                    type="button"
                    onClick={() => ing.setViewMode('page')}
                    aria-pressed={ing.viewMode === 'page'}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                      ing.viewMode === 'page'
                        ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/80 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t('ingestion.singlePage')}
                  </button>
                  <button
                    type="button"
                    onClick={() => ing.setViewMode('all')}
                    aria-pressed={ing.viewMode === 'all'}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                      ing.viewMode === 'all'
                        ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/80 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t('ingestion.allPages')}
                  </button>
                </div>
              </div>
            )}

            {/* Right: Save Button, Zoom, Sync Scroll & Export */}
            {ing.selectedDoc && (
              <div className="flex items-center gap-2">
                {/* Dynamic Save Button */}
                <button
                  type="button"
                  onClick={ing.handleSaveDocument}
                  disabled={!ing.isDirty || ing.isSaving}
                  aria-label={t('ingestion.saveChanges')}
                  title={`${t('ingestion.saveChanges')} (Ctrl+S)`}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all focus-ring active:scale-95 shadow-md ${
                    ing.isDirty
                      ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-950/40 cursor-pointer'
                      : 'bg-slate-900 border border-slate-800 text-slate-400 opacity-60 cursor-not-allowed'
                  }`}
                >
                  {ing.isSaving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{t('ingestion.saving')}</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>{t('ingestion.saveChanges')}</span>
                    </>
                  )}
                </button>

                {/* Zoom Controls */}
                <div className="flex items-center bg-slate-950 rounded-xl border border-slate-800 p-0.5 text-slate-300">
                  <button
                    type="button"
                    onClick={handleZoomOut}
                    aria-label={t('translation.zoomOut')}
                    title={t('translation.zoomOut')}
                    className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-slate-200 focus-ring"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleZoomReset}
                    aria-label={t('translation.resetZoom')}
                    title={t('translation.resetZoom')}
                    className="px-2 py-0.5 text-[10px] font-mono font-bold text-cyan-300 hover:text-cyan-200"
                  >
                    {ing.zoomLevel}%
                  </button>
                  <button
                    type="button"
                    onClick={handleZoomIn}
                    aria-label={t('translation.zoomIn')}
                    title={t('translation.zoomIn')}
                    className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-slate-200 focus-ring"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => ing.setSyncScroll(!ing.syncScroll)}
                  aria-pressed={ing.syncScroll}
                  aria-label={t('translation.syncScroll')}
                  title={t('translation.syncScroll')}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all focus-ring active:scale-95 ${
                    ing.syncScroll ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/80 shadow-sm' : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Link className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{t('ingestion.sync')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => onUpdateSettings?.({ editorWordWrap: settings?.editorWordWrap === false ? true : false })}
                  aria-pressed={settings?.editorWordWrap !== false}
                  aria-label={t('settings.wordWrap')}
                  title={t('settings.wordWrapDesc')}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all focus-ring active:scale-95 ${
                    settings?.editorWordWrap !== false ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/80 shadow-sm' : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <WrapText className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{t('settings.wordWrap')}</span>
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    if (ing.markdownContent) {
                      await navigator.clipboard.writeText(ing.markdownContent)
                      setCopiedMarkdown(true)
                      toast.success(t('ingestion.markdownCopied'))
                      setTimeout(() => setCopiedMarkdown(false), 2000)
                    }
                  }}
                  aria-label={t('ingestion.copyMarkdown')}
                  title={t('ingestion.copyMarkdown')}
                  className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-cyan-300 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all focus-ring active:scale-95"
                >
                  {copiedMarkdown ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-cyan-400" />
                  )}
                  <span className="hidden sm:inline">{t('ingestion.copyMarkdown')}</span>
                </button>

                <div className="flex items-center gap-1 bg-slate-950 rounded-xl border border-slate-800 p-0.5 shadow-sm">
                  <button
                    type="button"
                    onClick={() => {
                      ing.handleExportMarkdown('pdf')
                      toast.info(t('translation.exportPdf'))
                    }}
                    aria-label={t('translation.exportPdf')}
                    title={t('translation.exportPdf')}
                    className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 hover:text-cyan-300 text-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all focus-ring active:scale-95"
                  >
                    <Download className="w-3.5 h-3.5 text-cyan-400" />
                    <span>PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      ing.handleExportMarkdown('md')
                      toast.info(t('translation.exportMd'))
                    }}
                    aria-label={t('translation.exportMd')}
                    title={t('translation.exportMd')}
                    className="px-2 py-1.5 bg-slate-900 hover:bg-slate-800 hover:text-cyan-300 text-slate-300 text-xs font-semibold rounded-lg flex items-center gap-1 transition-all focus-ring active:scale-95 font-mono"
                  >
                    MD
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Fallback Embeddings Warning Banner */}
          {ing.selectedDoc && (ing.selectedDoc.status === 'indexed_fallback' || ing.selectedDoc.usedFallbackEmbeddings) && (
            <div className="bg-amber-950/40 border-b border-amber-800/60 px-4 py-2 flex items-center justify-between gap-3 text-xs text-amber-200 shrink-0">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  <strong>Vettorizzazione in modalità Fallback:</strong> Questo documento è indicizzato con vettori base perché Ollama non era attivo durante l'ingestione.
                </span>
              </div>
              <button
                type="button"
                onClick={() => ing.handleSaveDocument()}
                disabled={ing.isSaving}
                className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm focus-ring shrink-0"
                title="Re-indicizza calcolando i vettori semantici da Ollama"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${ing.isSaving ? 'animate-spin' : ''}`} />
                <span>Re-indicizza Vettori</span>
              </button>
            </div>
          )}

          {/* Main Paginated Split Layout */}
          {!ing.selectedDoc ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12 space-y-3 text-slate-400">
              <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-cyan-500/40">
                <Layers className="w-7 h-7" />
              </div>
              <div className="font-semibold text-slate-200 text-sm">{t('ingestion.noDocumentSelected')}</div>
              <p className="text-xs max-w-md text-slate-400 leading-relaxed">
                {t('ingestion.noDocSelectedPrompt')}
              </p>
            </div>
          ) : (
            <div className="flex-1 flex overflow-hidden">
              {/* Left Pane: Preview Originale (Visual/Source Preview) */}
              <div
                style={{ width: `${previewWidth}px` }}
                className="border-r border-slate-800 bg-slate-950 flex flex-col overflow-hidden shrink-0"
              >
                <div className="h-10 px-4 bg-slate-900/90 border-b border-slate-800 text-xs font-semibold text-slate-300 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2 text-cyan-300">
                    <FileText className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{t('ingestion.sourcePreview')}</span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                    {ing.viewMode === 'page' ? `${t('ingestion.singlePage')} ${activePageNum} / ${totalPages}` : `${totalPages} ${t('ingestion.pages')}`}
                  </span>
                </div>

                <div
                  ref={ing.leftPaneRef}
                  onScroll={ing.handleLeftPaneScroll}
                  onWheel={handlePreviewWheel}
                  className="flex-1 overflow-y-auto p-4 bg-slate-950/60"
                >
                  {ing.viewMode === 'page' ? (
                    <SourcePagePreview
                      docId={ing.selectedDoc.id}
                      pageNumber={activePageNum}
                      totalPages={totalPages}
                      pageContent={activePageData.content}
                      zoomLevel={ing.zoomLevel}
                    />
                  ) : (
                    parsedPages.map((page) => (
                      <SourcePagePreview
                        key={page.pageNumber}
                        docId={ing.selectedDoc!.id}
                        pageNumber={page.pageNumber}
                        totalPages={totalPages}
                        pageContent={page.content}
                        zoomLevel={ing.zoomLevel}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Resizable Preview Divider Handle */}
              <div
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-valuenow={previewWidth}
                aria-valuemin={250}
                aria-valuemax={950}
                aria-label={t('coding.resizePanels')}
                onMouseDown={handlePreviewMouseDown}
                onKeyDown={handlePreviewKeyDown}
                className={`w-1.5 hover:w-2 hover:bg-cyan-500 bg-slate-800/80 cursor-col-resize transition-all shrink-0 flex items-center justify-center group focus-ring ${
                  isPreviewResizing ? 'bg-cyan-500 w-2 ring-2 ring-cyan-500/50' : ''
                }`}
                title={t('coding.resizePanels')}
              >
                <GripVertical className={`w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity ${isPreviewResizing ? 'opacity-100 text-slate-950' : ''}`} />
              </div>

              {/* Right Pane: Editor Markdown (Monaco Editor) */}
              <div className={`flex-1 min-w-0 bg-slate-950 flex flex-col overflow-hidden ${isPreviewResizing ? 'pointer-events-none select-none' : ''}`}>
                <div className="h-10 px-4 bg-slate-900/90 border-b border-slate-800 text-xs font-semibold text-slate-300 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2 text-cyan-300">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{t('ingestion.markdownEditor')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {ing.isDirty && (
                      <span className="text-[10px] text-amber-400 font-mono">
                        {t('ingestion.unsavedChanges')}
                      </span>
                    )}
                    <span className="text-[11px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                      {ing.markdownContent.length} chars
                    </span>
                  </div>
                </div>

                <div className="flex-1 bg-slate-950">
                  <Editor
                    height="100%"
                    theme="vs-dark"
                    language="markdown"
                    value={ing.markdownContent}
                    onChange={(val) => ing.setMarkdownContent(val || '')}
                    onMount={ing.handleEditorDidMount}
                    options={{
                      fontSize: 13,
                      minimap: { enabled: false },
                      wordWrap: settings?.editorWordWrap !== false ? 'on' : 'off',
                      automaticLayout: true,
                      fontFamily: 'Fira Code, monospace',
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {settings && onUpdateSettings && (
        <SystemPromptModal
          isOpen={ing.isPromptModalOpen}
          onClose={() => ing.setIsPromptModalOpen(false)}
          module="vision"
          moduleTitle={t('ingestion.title')}
          activeModelName={settings?.visionModel || 'llama3.2-vision'}
          settings={settings}
          onUpdateSettings={onUpdateSettings}
        />
      )}

      <TranslateInplaceModal
        isOpen={translateInplaceDoc !== null}
        filename={translateInplaceDoc?.filename || ''}
        isTranslating={ing.isTranslatingInplace}
        translateProgress={ing.translateProgress}
        defaultTargetDir={settings?.translationOutputFolder || ''}
        onClose={() => setTranslateInplaceDoc(null)}
        onConfirm={async (sourceLang, targetLang, targetDir) => {
          if (!translateInplaceDoc) return
          await ing.handleTranslateInplace(
            translateInplaceDoc.id,
            sourceLang,
            targetLang,
            settings?.translationModel || settings?.defaultModel,
            false,
            targetDir
          )
          setTranslateInplaceDoc(null)
        }}
      />
    </div>
  )
}
