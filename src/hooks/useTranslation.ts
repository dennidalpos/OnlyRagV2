import { useState, useRef, useCallback, useEffect } from 'react'
import { IngestedDocument, AppSettings, DiagnosticsData, TranslateProgressPayload } from '../types'
import { apiService } from '../services/api'
import { logger } from '../lib/logger'
import { getEffectivePrompt } from '../constants/promptConfig'
import { useIngestedDocuments } from './useIngestedDocuments'
import { useTranslation as useI18n } from '../i18n'
import { acquireGlobalTaskLock, releaseGlobalTaskLock, peekGlobalTaskLock } from '../services/globalTaskLock'
import { normalizeError } from '../lib/errors/errorNormalizer'
import { resolveModelContextLength } from '../../shared/domain/settings/modelContextPreference'

export const LANGUAGES = [
  'English',
  'Italian',
  'German',
  'French',
  'Spanish',
  'Portuguese',
  'Russian',
  'Chinese',
  'Japanese',
]

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

      if (
        !insideCodeFence &&
        (currentChunk + '\n\n' + para).length > maxChunkLength &&
        currentChunk.length > 0
      ) {
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

export function useDocumentTranslation(settings?: AppSettings, diagnostics?: DiagnosticsData | null) {
  const { t } = useI18n()
  const [isPromptModalOpen, setIsPromptModalOpen] = useState<boolean>(false)
  const [selectedDoc, setSelectedDoc] = useState<IngestedDocument | null>(null)
  const [sourceLang, setSourceLang] = useState('Italian')
  const [targetLang, setTargetLang] = useState('English')
  const [translatedMarkdown, setTranslatedMarkdown] = useState('')
  const [isTranslating, setIsTranslating] = useState(false)

  // Mirrors isTranslating into the cross-module task lock so the coding agent/ingestion
  // module can block starting their own task while a translation is mid-flight (see
  // globalTaskLock.ts).
  useEffect(() => {
    if (isTranslating) {
      acquireGlobalTaskLock('translation')
      return () => releaseGlobalTaskLock('translation')
    }
    releaseGlobalTaskLock('translation')
  }, [isTranslating])

  const [currentChunkIndex, setCurrentChunkIndex] = useState(0)
  const [totalChunks, setTotalChunks] = useState(0)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [translationError, setTranslationError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'split' | 'diff'>('split')
  const [syncScroll, setSyncScroll] = useState<boolean>(true)

  const [currentPage, setCurrentPage] = useState<number>(1)
  const [pageViewMode, setPageViewMode] = useState<'page' | 'all'>('all')

  const leftEditorRef = useRef<any>(null)
  const editorRef = useRef<any>(null)
  const isSyncingScrollRef = useRef<boolean>(false)
  const abortTranslationRef = useRef<boolean>(false)

  const syncEditorScroll = (source: any, target: any) => {
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

  const handleLeftEditorDidMount = (editor: any) => {
    leftEditorRef.current = editor
    editor.onDidScrollChange((e: any) => {
      if (!syncScroll || isSyncingScrollRef.current || !editorRef.current || !e.scrollTopChanged) return
      isSyncingScrollRef.current = true
      syncEditorScroll(editor, editorRef.current)
      requestAnimationFrame(() => {
        isSyncingScrollRef.current = false
      })
    })
  }

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor
    editor.onDidScrollChange((e: any) => {
      if (!syncScroll || isSyncingScrollRef.current || !leftEditorRef.current || !e.scrollTopChanged) return
      isSyncingScrollRef.current = true
      syncEditorScroll(editor, leftEditorRef.current)
      requestAnimationFrame(() => {
        isSyncingScrollRef.current = false
      })
    })
  }

  const handleDocsUpdated = useCallback((docs: IngestedDocument[]) => {
    setSelectedDoc((prev) => {
      if (!prev) return docs.length > 0 ? docs[0] : null
      return docs.find((d) => d.id === prev.id) || (docs.length > 0 ? docs[0] : null)
    })
  }, [])

  const { documents, refetchDocuments: fetchDocuments } = useIngestedDocuments({
    onDocsUpdated: handleDocsUpdated,
  })

  const handleSwapLanguages = () => {
    const prevSource = sourceLang
    setSourceLang(targetLang)
    setTargetLang(prevSource)
  }

  const handleStopTranslation = useCallback(async () => {
    abortTranslationRef.current = true
    if (window.electronAPI?.cancelOllamaStream) {
      try {
        await window.electronAPI.cancelOllamaStream()
      } catch (err: any) {
        logger.warn('useTranslation', `Error cancelling Ollama stream: ${err.message}`)
      }
    }
    setIsTranslating(false)
  }, [])

  const handleStartTranslation = async () => {
    if (!selectedDoc) return

    const busyModule = peekGlobalTaskLock()
    if (busyModule && busyModule !== 'translation') {
      const message = busyModule === 'coding'
        ? t('common.crossModuleTaskBlocked', { module: t('common.moduleNameCoding') })
        : t('common.crossModuleTaskBlocked', { module: t('common.moduleNameIngestion') })
      setTranslationError(message)
      setTimeout(() => setTranslationError(null), 5000)
      return
    }

    abortTranslationRef.current = false
    setIsTranslating(true)
    setTranslatedMarkdown('')
    setCurrentChunkIndex(0)

    try {
      const sourceMarkdown = pageViewMode === 'page' && selectedDoc.numPages > 1
        ? extractPageMarkdown(selectedDoc.extractedMarkdown || '', currentPage)
        : (selectedDoc.extractedMarkdown || '')

      const chunks = splitMarkdownForTranslation(sourceMarkdown)
      setTotalChunks(chunks.length)

      let accumulatedResults = ''

      const modelToUse = settings?.translationModel || settings?.defaultModel || 'llama3.2'

      // The language pair goes in as template variables. It used to be appended as a second
      // "Strict Directives" block that restated markdown preservation and the no-preamble rule
      // the prompt already carried, so every chunk shipped those rules twice — and the template's
      // own {sourceLang}/{targetLang} placeholders went out to the model unsubstituted.
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
          await window.electronAPI.generateOllamaStream(modelToUse, prompt, (c) => {
            if (abortTranslationRef.current) return
            currentChunkTranslation += c
            // Live token streaming into Monaco editor
            const livePreview = accumulatedResults + (accumulatedResults ? '\n\n' : '') + currentChunkTranslation
            setTranslatedMarkdown(livePreview)
          })
        }

        if (abortTranslationRef.current) break

        accumulatedResults += (accumulatedResults ? '\n\n' : '') + (currentChunkTranslation || chunk)
        setTranslatedMarkdown(accumulatedResults)
      }
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'Translation')
      logger.error('TranslationView', `Error translating document: ${normalized.message}`)
      setTranslationError(normalized.remediation ? `${normalized.message} — ${normalized.remediation}` : normalized.message)
    } finally {
      setIsTranslating(false)
    }
  }

  const handleExportTranslation = async (format: 'pdf' | 'docx' | 'md' = 'pdf') => {
    if (!translatedMarkdown.trim()) return
    setExportMessage(t('translation.exportPreparing', { format: format.toUpperCase() }))
    try {
      const res = await apiService.exportDocument(translatedMarkdown, format, settings?.translationOutputFolder)
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
    if (isTranslating && window.electronAPI?.cancelOllamaStream) {
      window.electronAPI.cancelOllamaStream().catch(() => {})
    }
    setIsTranslating(false)
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
    documents,
    selectedDoc,
    setSelectedDoc,
    sourceLang,
    setSourceLang,
    targetLang,
    setTargetLang,
    translatedMarkdown,
    setTranslatedMarkdown,
    isTranslating,
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
    editorRef,
    handleLeftEditorDidMount,
    handleEditorDidMount,
    fetchDocuments,
    handleSwapLanguages,
    handleStopTranslation,
    handleStartTranslation,
    handleExportTranslation,
    handleResetTranslation,
  }
}

export function useInplaceTranslation(settings?: AppSettings) {
  const { t } = useI18n()
  const [selectedDoc, setSelectedDoc] = useState<IngestedDocument | null>(null)
  const [sourceLang, setSourceLang] = useState('Italian')
  const [targetLang, setTargetLang] = useState('English')
  const [targetDir, setTargetDir] = useState<string>(settings?.translationOutputFolder || '')
  const [isTranslating, setIsTranslating] = useState(false)
  const [translateProgress, setTranslateProgress] = useState<TranslateProgressPayload | null>(null)
  const [status, setStatus] = useState<{ success: boolean; message: string; filename?: string } | null>(null)

  // Listen to live streaming translation progress from Electron / sidecar
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onTranslateProgress?.((payload) => {
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

  // Mirrors isTranslating into the cross-module task lock
  useEffect(() => {
    if (isTranslating) {
      acquireGlobalTaskLock('translation')
      return () => releaseGlobalTaskLock('translation')
    }
    releaseGlobalTaskLock('translation')
  }, [isTranslating])

  const handleDocsUpdated = useCallback((docs: IngestedDocument[]) => {
    setSelectedDoc((prev) => {
      const compatibleDocs = docs.filter((d) => d.fileType === 'pdf' || d.fileType === 'docx')
      if (!prev) return compatibleDocs.length > 0 ? compatibleDocs[0] : null
      return compatibleDocs.find((d) => d.id === prev.id) || (compatibleDocs.length > 0 ? compatibleDocs[0] : null)
    })
  }, [])

  const { documents, refetchDocuments: fetchDocuments } = useIngestedDocuments({
    onDocsUpdated: handleDocsUpdated,
  })

  const compatibleDocs = documents.filter((d) => d.fileType === 'pdf' || d.fileType === 'docx')

  const handleSwapLanguages = () => {
    const prevSource = sourceLang
    setSourceLang(targetLang)
    setTargetLang(prevSource)
  }

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

    const busyModule = peekGlobalTaskLock()
    if (busyModule && busyModule !== 'translation') {
      const message = busyModule === 'coding'
        ? t('common.crossModuleTaskBlocked', { module: t('common.moduleNameCoding') })
        : t('common.crossModuleTaskBlocked', { module: t('common.moduleNameIngestion') })
      setStatus({ success: false, message })
      return
    }

    if (!targetDir.trim()) {
      setStatus({ success: false, message: t('translation.inplaceTargetDirRequired') })
      return
    }

    setIsTranslating(true)
    setStatus(null)
    setTranslateProgress(null)

    try {
      const modelToUse = settings?.translationModel || settings?.defaultModel
      const res = await apiService.translateDocumentInplace(
        docToTranslate.id,
        sourceLang,
        targetLang,
        modelToUse,
        false,
        targetDir,
        modelToUse ? resolveModelContextLength(modelToUse, settings?.modelContextLengths, 4096) : undefined
      )

      if (res.success && res.data) {
        setStatus({
          success: true,
          message: t('translation.inplaceSuccess', { filename: res.data.filename }),
          filename: res.data.filename,
        })
        await fetchDocuments()
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
      setIsTranslating(false)
    }
  }

  return {
    documents: compatibleDocs,
    allDocuments: documents,
    selectedDoc,
    setSelectedDoc,
    sourceLang,
    setSourceLang,
    targetLang,
    setTargetLang,
    targetDir,
    setTargetDir,
    isTranslating,
    translateProgress,
    status,
    setStatus,
    handleSwapLanguages,
    handleSelectTargetDir,
    handleStartInplaceTranslation,
    fetchDocuments,
  }
}


