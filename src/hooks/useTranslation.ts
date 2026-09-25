import { useState, useRef, useCallback, useEffect } from 'react'
import { IngestedDocument, AppSettings, DiagnosticsData, TranslateProgressPayload } from '../types'
import { electronApi } from '../services/electronApi'
import { logger } from '../lib/logger'
import { getEffectivePrompt } from '../constants/promptConfig'
import { notifyDocumentsChanged, useIngestedDocuments } from './useIngestedDocuments'
import { useDocumentMarkdown } from './useDocumentMarkdown'
import { loadDocumentMarkdown } from '../services/documentMarkdown'
import { useTranslation as useI18n } from '../i18n'
import { acquireGlobalTaskLock, releaseGlobalTaskLock, peekGlobalTaskLock } from '../services/globalTaskLock'
import { normalizeError } from '../lib/errors/errorNormalizer'
import { resolveModelContextLength } from '../../shared/domain/settings/modelContextPreference'
import { extractHardwareFacts } from '../services/hardwareRecommendationEngine'
import { resolveMaxContextTokens } from '../../shared/domain/hardware/hardwareProfileTiers'
import { useOllamaModelMetrics } from './useOllamaModelMetrics'
import { useOllamaGenerationState } from './useOllamaGenerationState'
import { resolveOllamaThinkingPreference } from '../../shared/domain/agent/ollamaThinkingPolicy'
import { resolveConfiguredModel } from '../../shared/domain/settings/configuredModel'
import { errorMessage } from '../../shared/domain/errors/errorMessage'
import type { OnMount } from '@monaco-editor/react'

/** The editor instance Monaco hands to `onMount`; a type-only import, so Monaco still loads on demand. */
type MonacoCodeEditor = Parameters<OnMount>[0]

export const LANGUAGES = ['English', 'Italian', 'German', 'French', 'Spanish', 'Portuguese', 'Russian', 'Chinese', 'Japanese']

export function splitMarkdownForTranslation(markdown: string, maxChunkLength: number = 3500): string[] {
  if (!markdown || !markdown.trim()) return []

  // 1. Initial split by explicit page headers if present
  let initialChunks: string[] = []
  if (/(?:^|\n)(?=## Page \d+|# Page \d+|--- Page \d+ ---)/i.test(markdown)) {
    initialChunks = markdown.split(/(?=(?:^|\n)(?:## Page \d+|# Page \d+|--- Page \d+ ---))/i)
  } else {
    initialChunks = [markdown]
  }

  const finalChunks: string[] = []

  for (const block of initialChunks) {
    const trimmed = block.trim()
    if (!trimmed) continue

    if (trimmed.length <= maxChunkLength) {
      finalChunks.push(trimmed)
      continue
    }

    // 2. Block-aware paragraph splitting (protects code fences ```)
    const paragraphs = trimmed.split(/\n\n+/)
    let currentChunk = ''
    let insideCodeFence = false

    for (const para of paragraphs) {
      const codeFenceCount = (para.match(/```/g) || []).length
      if (codeFenceCount % 2 !== 0) {
        insideCodeFence = !insideCodeFence
      }

      if (!insideCodeFence && (currentChunk + '\n\n' + para).length > maxChunkLength && currentChunk.length > 0) {
        finalChunks.push(currentChunk.trim())
        currentChunk = para
      } else {
        currentChunk = currentChunk ? currentChunk + '\n\n' + para : para
      }
    }

    if (currentChunk.trim().length > 0) {
      finalChunks.push(currentChunk.trim())
    }
  }

  return finalChunks.length > 0 ? finalChunks : [markdown.trim()]
}

export function extractPageMarkdown(fullMarkdown: string, pageNumber: number): string {
  if (!fullMarkdown) return ''
  const regex = new RegExp(`(?:^|\\n)##\\s+Page\\s+${pageNumber}\\b[\\s\\S]*?(?=(?:\\n##\\s+Page\\s+\\d+|$))`, 'i')
  const match = fullMarkdown.match(regex)
  if (match) {
    return match[0].trim()
  }
  return fullMarkdown
}

const isLayoutTranslatable = (doc: IngestedDocument) => doc.fileType === 'pdf' || doc.fileType === 'docx'

export type TranslationJobKind = 'markdown' | 'inplace'

/** State both translators of one view share: the language pair and which of them is running. */
export interface SharedTranslationState {
  sourceLang: string
  setSourceLang: (lang: string) => void
  targetLang: string
  setTargetLang: (lang: string) => void
  activeJob: TranslationJobKind | null
  setActiveJob: (job: TranslationJobKind | null) => void
}

/** Owned by the view that mounts both translators, so one job at a time runs across its tabs. */
export function useSharedTranslationState(): SharedTranslationState {
  const [sourceLang, setSourceLang] = useState('Italian')
  const [targetLang, setTargetLang] = useState('English')
  const [activeJob, setActiveJob] = useState<TranslationJobKind | null>(null)
  return { sourceLang, setSourceLang, targetLang, setTargetLang, activeJob, setActiveJob }
}

/**
 * State shared by the Markdown and the layout-preserving translators: document selection, language pair,
 * the cross-module task lock, and the model/context/thinking options resolved from settings.
 */
function useTranslationBase(
  settings: AppSettings | undefined,
  diagnostics: DiagnosticsData | null | undefined,
  jobKind: TranslationJobKind,
  acceptsDocument?: (doc: IngestedDocument) => boolean,
  sharedState?: SharedTranslationState,
) {
  const { t } = useI18n()
  const { metrics: modelMetrics } = useOllamaModelMetrics(settings?.ollamaHost)
  const hardwareDefault = resolveMaxContextTokens('Auto', extractHardwareFacts(diagnostics || null))
  const [selectedDoc, setSelectedDoc] = useState<IngestedDocument | null>(null)
  const ownState = useSharedTranslationState()
  const { sourceLang, setSourceLang, targetLang, setTargetLang, activeJob, setActiveJob } = sharedState ?? ownState
  const [isTranslating, setIsTranslating] = useState(false)
  /** The other translator of the same view is running: both use the same 'translation' lock key. */
  const otherJobRunning = activeJob !== null && activeJob !== jobKind

  useEffect(() => {
    if (!isTranslating) return
    setActiveJob(jobKind)
    return () => setActiveJob(null)
  }, [isTranslating, jobKind, setActiveJob])

  // Mirrors isTranslating into the cross-module task lock so the coding agent/ingestion module can block starting their own task while a translation is mid-flight (see globalTaskLock.ts).
  useEffect(() => {
    if (!isTranslating) return
    acquireGlobalTaskLock('translation')
    return () => releaseGlobalTaskLock('translation')
  }, [isTranslating])

  const acceptsDocumentRef = useRef(acceptsDocument)
  const handleDocsUpdated = useCallback((docs: IngestedDocument[]) => {
    const accepted = acceptsDocumentRef.current ? docs.filter(acceptsDocumentRef.current) : docs
    setSelectedDoc((prev) => (prev && accepted.find((d) => d.id === prev.id)) || accepted[0] || null)
  }, [])

  const { documents: allDocuments, refetchDocuments: fetchDocuments } = useIngestedDocuments({ onDocsUpdated: handleDocsUpdated })
  const documents = acceptsDocument ? allDocuments.filter(acceptsDocument) : allDocuments

  const handleSwapLanguages = () => {
    setSourceLang(targetLang)
    setTargetLang(sourceLang)
  }

  /** Message explaining why another module's running task blocks translation, or null when translation may start. */
  const crossModuleBlockMessage = (): string | null => {
    if (otherJobRunning) return t('translation.otherJobRunning')
    const busyModule = peekGlobalTaskLock()
    if (!busyModule || busyModule === 'translation') return null
    return t('common.crossModuleTaskBlocked', { module: t(busyModule === 'coding' ? 'common.moduleNameCoding' : 'common.moduleNameIngestion') })
  }

  /** Model, context window and thinking flag for the configured translation model; null when no model is configured. */
  const resolveGenerationOptions = (): { model: string; numCtx: number; think: boolean } | null => {
    const model = resolveConfiguredModel('translation', settings)
    if (!model) return null
    return {
      model,
      numCtx: resolveModelContextLength(model, settings?.modelContextLengths, hardwareDefault, modelMetrics[model]?.contextLength),
      think: resolveOllamaThinkingPreference(model, settings || {}, modelMetrics).think,
    }
  }

  return {
    t,
    documents,
    fetchDocuments,
    selectedDoc,
    setSelectedDoc,
    sourceLang,
    setSourceLang,
    targetLang,
    setTargetLang,
    handleSwapLanguages,
    isTranslating,
    setIsTranslating,
    crossModuleBlockMessage,
    otherJobRunning,
    resolveGenerationOptions,
  }
}

export function useDocumentTranslation(settings?: AppSettings, diagnostics?: DiagnosticsData | null, sharedState?: SharedTranslationState) {
  const base = useTranslationBase(settings, diagnostics, 'markdown', undefined, sharedState)
  const { t, selectedDoc, sourceLang, targetLang, isTranslating, setIsTranslating, setSelectedDoc } = base
  const { markdown: selectedDocMarkdown } = useDocumentMarkdown(selectedDoc)
  const [isPromptModalOpen, setIsPromptModalOpen] = useState<boolean>(false)
  const [translatedMarkdown, setTranslatedMarkdown] = useState('')
  const [isTranslationComplete, setIsTranslationComplete] = useState(false)
  const { generationState, trackOperation } = useOllamaGenerationState()
  const activeStreamIdRef = useRef<string | null>(null)

  const [currentChunkIndex, setCurrentChunkIndex] = useState(0)
  const [totalChunks, setTotalChunks] = useState(0)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [translationError, setTranslationError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'split' | 'diff'>('split')
  const [syncScroll, setSyncScroll] = useState<boolean>(true)

  const [currentPage, setCurrentPage] = useState<number>(1)
  const [pageViewMode, setPageViewMode] = useState<'page' | 'all'>('all')

  const leftEditorRef = useRef<MonacoCodeEditor | null>(null)
  const editorRef = useRef<MonacoCodeEditor | null>(null)
  const isSyncingScrollRef = useRef<boolean>(false)
  const abortTranslationRef = useRef<boolean>(false)

  const syncEditorScroll = (source: MonacoCodeEditor, target: MonacoCodeEditor) => {
    const scrollHeight = source.getScrollHeight()
    const layout = source.getLayoutInfo()
    const clientHeight = layout ? layout.height : 0
    const maxScroll = scrollHeight - clientHeight
    if (maxScroll <= 0) return

    const scrollPercent = source.getScrollTop() / maxScroll
    const targetScrollHeight = target.getScrollHeight()
    const targetLayout = target.getLayoutInfo()
    const targetClientHeight = targetLayout ? targetLayout.height : 0
    const maxTargetScroll = targetScrollHeight - targetClientHeight
    if (maxTargetScroll > 0) {
      target.setScrollTop(scrollPercent * maxTargetScroll)
    }
  }

  const handleLeftEditorDidMount = (editor: MonacoCodeEditor) => {
    leftEditorRef.current = editor
    editor.onDidScrollChange((e) => {
      if (!syncScroll || isSyncingScrollRef.current || !editorRef.current || !e.scrollTopChanged) return
      isSyncingScrollRef.current = true
      syncEditorScroll(editor, editorRef.current)
      requestAnimationFrame(() => {
        isSyncingScrollRef.current = false
      })
    })
  }

  const handleEditorDidMount = (editor: MonacoCodeEditor) => {
    editorRef.current = editor
    editor.onDidScrollChange((e) => {
      if (!syncScroll || isSyncingScrollRef.current || !leftEditorRef.current || !e.scrollTopChanged) return
      isSyncingScrollRef.current = true
      syncEditorScroll(editor, leftEditorRef.current)
      requestAnimationFrame(() => {
        isSyncingScrollRef.current = false
      })
    })
  }

  const handleStopTranslation = useCallback(async () => {
    abortTranslationRef.current = true
    const operationId = activeStreamIdRef.current
    if (operationId && window.electronAPI?.cancelOllamaStream) {
      try {
        await window.electronAPI.cancelOllamaStream({ operationId })
      } catch (err: unknown) {
        logger.warn('useTranslation', `Error cancelling Ollama stream: ${errorMessage(err)}`)
      }
    }
    activeStreamIdRef.current = null
    trackOperation(null)
    setIsTranslating(false)
  }, [trackOperation])

  const showTranslationError = (message: string) => {
    setTranslationError(message)
    setTimeout(() => setTranslationError(null), 5000)
  }

  const handleStartTranslation = async () => {
    if (!selectedDoc) return

    const blockedMessage = base.crossModuleBlockMessage()
    if (blockedMessage) {
      showTranslationError(blockedMessage)
      return
    }
    const generation = base.resolveGenerationOptions()
    if (!generation) {
      showTranslationError(t('translation.noModelConfigured'))
      return
    }

    const fullMarkdown = selectedDocMarkdown ?? (await loadDocumentMarkdown(selectedDoc))
    if (fullMarkdown === null) {
      showTranslationError(t('common.documentLoadFailed'))
      return
    }

    abortTranslationRef.current = false
    setIsTranslating(true)
    setIsTranslationComplete(false)
    setTranslatedMarkdown('')
    setCurrentChunkIndex(0)

    try {
      const sourceMarkdown = pageViewMode === 'page' && selectedDoc.numPages > 1 ? extractPageMarkdown(fullMarkdown, currentPage) : fullMarkdown

      const chunks = splitMarkdownForTranslation(sourceMarkdown)
      setTotalChunks(chunks.length)

      let accumulatedResults = ''

      // The language pair goes in as template variables.
      const systemInstruction = getEffectivePrompt('translation', settings, {
        variables: { sourceLang, targetLang },
      }).prompt

      for (let i = 0; i < chunks.length; i++) {
        if (abortTranslationRef.current) {
          logger.info('useTranslation', 'Translation aborted by user')
          break
        }

        setCurrentChunkIndex(i + 1)
        const chunk = chunks[i]
        if (!chunk.trim()) continue

        const prompt = `${systemInstruction}\n\n[DOCUMENT CONTENT TO TRANSLATE]:\n${chunk}`

        let currentChunkTranslation = ''
        if (window.electronAPI?.generateOllamaStream) {
          const operationId = crypto.randomUUID()
          activeStreamIdRef.current = operationId
          trackOperation(operationId)
          try {
            const result = await window.electronAPI.generateOllamaStream(
              { model: generation.model, prompt, options: { num_ctx: generation.numCtx, think: generation.think }, host: settings?.ollamaHost, operationId },
              (c) => {
                if (abortTranslationRef.current) return
                currentChunkTranslation += c
                const livePreview = accumulatedResults + (accumulatedResults ? '\n\n' : '') + currentChunkTranslation
                setTranslatedMarkdown(livePreview)
              },
            )
            if (!result.success) throw new Error(result.error || 'Ollama translation failed.')
            if (!currentChunkTranslation.trim()) throw new Error('Ollama returned an empty translation.')
          } finally {
            if (activeStreamIdRef.current === operationId) activeStreamIdRef.current = null
            trackOperation(null)
          }
        } else {
          throw new Error('Local Ollama API offline or window.electronAPI unattached.')
        }

        if (abortTranslationRef.current) break

        accumulatedResults += (accumulatedResults ? '\n\n' : '') + currentChunkTranslation
        setTranslatedMarkdown(accumulatedResults)
      }
      if (!abortTranslationRef.current) setIsTranslationComplete(true)
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'Translation')
      logger.error('TranslationView', `Error translating document: ${normalized.message}`)
      setTranslationError(normalized.remediation ? `${normalized.message} — ${normalized.remediation}` : normalized.message)
    } finally {
      trackOperation(null)
      setIsTranslating(false)
    }
  }

  const handleExportTranslation = async (format: 'pdf' | 'docx' | 'md' = 'pdf') => {
    if (!isTranslationComplete || !translatedMarkdown.trim()) return
    setExportMessage(t('translation.exportPreparing', { format: format.toUpperCase() }))
    try {
      const res = await electronApi().exportDocument({ markdownContent: translatedMarkdown, format, outputFolder: settings?.translationOutputFolder })
      if (res.success) {
        setExportMessage(res.message || t('translation.exportSuccess', { format: format.toUpperCase() }))
      } else {
        setExportMessage(res.error || res.message || t('translation.exportCancelled'))
      }
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'Translation Export')
      setExportMessage(t('translation.exportError', { message: normalized.message }))
    } finally {
      setTimeout(() => setExportMessage(null), 5000)
    }
  }

  const handleResetTranslation = () => {
    abortTranslationRef.current = true
    if (activeStreamIdRef.current && window.electronAPI?.cancelOllamaStream) {
      window.electronAPI.cancelOllamaStream({ operationId: activeStreamIdRef.current }).catch(() => {})
    }
    setIsTranslating(false)
    setIsTranslationComplete(false)
    setTranslatedMarkdown('')
    setCurrentChunkIndex(0)
    setTotalChunks(0)
    setSelectedDoc(null)
    setExportMessage(null)
    setTranslationError(null)
  }

  return {
    isPromptModalOpen,
    setIsPromptModalOpen,
    documents: base.documents,
    selectedDoc,
    selectedDocMarkdown,
    setSelectedDoc,
    sourceLang,
    setSourceLang: base.setSourceLang,
    targetLang,
    setTargetLang: base.setTargetLang,
    translatedMarkdown,
    setTranslatedMarkdown,
    isTranslating,
    otherJobRunning: base.otherJobRunning,
    isTranslationComplete,
    generationState,
    currentChunkIndex,
    totalChunks,
    exportMessage,
    translationError,
    setTranslationError,
    viewMode,
    setViewMode,
    syncScroll,
    setSyncScroll,
    currentPage,
    setCurrentPage,
    pageViewMode,
    setPageViewMode,
    handleLeftEditorDidMount,
    handleEditorDidMount,
    fetchDocuments: base.fetchDocuments,
    handleSwapLanguages: base.handleSwapLanguages,
    handleStopTranslation,
    handleStartTranslation,
    handleExportTranslation,
    handleResetTranslation,
  }
}

/**
 * Layout-preserving translation. Its state must outlive the panel that shows it: the view mounts
 * this hook once, so switching to the Markdown tab keeps the job's progress and the 'translation'
 * task lock for as long as the sidecar job runs.
 */
export function useInplaceTranslation(settings?: AppSettings, diagnostics?: DiagnosticsData | null, sharedState?: SharedTranslationState) {
  const base = useTranslationBase(settings, diagnostics, 'inplace', isLayoutTranslatable, sharedState)
  const { t, selectedDoc, sourceLang, targetLang, isTranslating, setIsTranslating } = base
  const [targetDir, setTargetDir] = useState<string>(settings?.translationOutputFolder || '')
  const [translateProgress, setTranslateProgress] = useState<TranslateProgressPayload | null>(null)
  const [status, setStatus] = useState<{ success: boolean; message: string; filename?: string } | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)
  // Main assigns the task id and reports it on every progress event of the running job.
  const activeTaskIdRef = useRef<string | null>(null)
  const cancelRequestedRef = useRef(false)

  // Listen to live streaming translation progress from Electron / sidecar
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onTranslateProgress?.((payload) => {
      if (payload.taskId) activeTaskIdRef.current = payload.taskId
      setTranslateProgress(payload)
    })
    return () => {
      unsubscribe?.()
    }
  }, [])

  // Sync targetDir when settings change
  useEffect(() => {
    if (settings?.translationOutputFolder && !targetDir) {
      setTargetDir(settings.translationOutputFolder)
    }
  }, [settings?.translationOutputFolder, targetDir])

  const handleSelectTargetDir = async () => {
    if (!window.electronAPI?.openDirectoryDialog) return
    const dir = await window.electronAPI.openDirectoryDialog({
      title: t('translation.inplaceBrowseTitle'),
    })
    if (dir) {
      setTargetDir(dir)
    }
  }

  const handleStartInplaceTranslation = async (overrideDoc?: IngestedDocument) => {
    const docToTranslate = overrideDoc || selectedDoc
    if (!docToTranslate || isTranslating) return

    const blockedMessage = base.crossModuleBlockMessage()
    if (blockedMessage) {
      setStatus({ success: false, message: blockedMessage })
      return
    }

    if (!targetDir.trim()) {
      setStatus({ success: false, message: t('translation.inplaceTargetDirRequired') })
      return
    }
    const generation = base.resolveGenerationOptions()
    if (!generation) {
      setStatus({ success: false, message: t('translation.noModelConfigured') })
      return
    }

    setIsTranslating(true)
    setStatus(null)
    setTranslateProgress(null)
    activeTaskIdRef.current = null
    cancelRequestedRef.current = false

    try {
      const res = await electronApi().translateDocumentInplace({
        docId: docToTranslate.id,
        sourceLang,
        targetLang,
        model: generation.model,
        targetDir,
        numCtx: generation.numCtx,
        think: generation.think,
      })

      if (cancelRequestedRef.current && !(res.success && res.data)) {
        setStatus({ success: false, message: t('translation.inplaceCancelled') })
      } else if (res.success && res.data) {
        setStatus({
          success: true,
          message: t('translation.inplaceSuccess', { filename: res.data.filename }),
          filename: res.data.filename,
        })
        notifyDocumentsChanged()
        await base.fetchDocuments()
      } else {
        setStatus({
          success: false,
          message: res.error || t('translation.inplaceError', { message: 'unknown error' }),
        })
      }
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'InplaceTranslation')
      setStatus({
        success: false,
        message: t('translation.inplaceError', { message: normalized.message }),
      })
    } finally {
      activeTaskIdRef.current = null
      setIsCancelling(false)
      setIsTranslating(false)
    }
  }

  /** Asks Main to cancel the running job; the sidecar stops between pages and writes no output file. */
  const handleCancelInplaceTranslation = async () => {
    const taskId = activeTaskIdRef.current
    if (!taskId || !window.electronAPI?.cancelTask) return
    cancelRequestedRef.current = true
    setIsCancelling(true)
    await window.electronAPI.cancelTask({ taskId })
  }

  return {
    documents: base.documents,
    selectedDoc,
    setSelectedDoc: base.setSelectedDoc,
    sourceLang,
    setSourceLang: base.setSourceLang,
    targetLang,
    setTargetLang: base.setTargetLang,
    targetDir,
    setTargetDir,
    isTranslating,
    otherJobRunning: base.otherJobRunning,
    translateProgress,
    status,
    setStatus,
    handleSwapLanguages: base.handleSwapLanguages,
    handleSelectTargetDir,
    handleStartInplaceTranslation,
    isCancelling,
    canCancel: isTranslating && Boolean(translateProgress?.taskId),
    handleCancelInplaceTranslation,
  }
}

export type InplaceTranslationState = ReturnType<typeof useInplaceTranslation>
