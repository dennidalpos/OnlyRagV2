import { useState, useRef, useCallback, useEffect } from 'react'
import { IngestedDocument, AppSettings } from '../types'
import { apiService } from '../services/api'
import { logger } from '../lib/logger'
import { getEffectivePrompt } from '../components/common/SystemPromptModal'
import { useIngestedDocuments } from './useIngestedDocuments'
import { useTranslation as useI18n } from '../i18n'
import { acquireGlobalTaskLock, releaseGlobalTaskLock, peekGlobalTaskLock } from './useGlobalTaskLock'
import { normalizeError } from '../lib/errors/errorNormalizer'

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

export function useDocumentTranslation(settings?: AppSettings) {
  const { t } = useI18n()
  const [isPromptModalOpen, setIsPromptModalOpen] = useState<boolean>(false)
  const [selectedDoc, setSelectedDoc] = useState<IngestedDocument | null>(null)
  const [sourceLang, setSourceLang] = useState('Italian')
  const [targetLang, setTargetLang] = useState('English')
  const [translatedMarkdown, setTranslatedMarkdown] = useState('')
  const [isTranslating, setIsTranslating] = useState(false)

  // Mirrors isTranslating into the cross-module task lock so the coding agent/ingestion
  // module can block starting their own task while a translation is mid-flight (see
  // useGlobalTaskLock.ts).
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
      const effectiveSystemPrompt = settings ? getEffectivePrompt('translation', modelToUse, settings).prompt : ''
      const systemInstruction = effectiveSystemPrompt && effectiveSystemPrompt.trim().length > 0
        ? `${effectiveSystemPrompt}\n\nStrict Directives:\n1. Translate the input text from ${sourceLang} to ${targetLang}.\n2. Preserve all Markdown headings (#, ##), code blocks (\`\`\`), table grids, HTML tags, and formula syntax intact.\n3. Output ONLY the translated content without meta comments or greetings.`
        : `You are an expert technical translator. Translate the following text from ${sourceLang} to ${targetLang}.\nPreserve all Markdown headings, bullet points, tables, code blocks (\`\`\`), and formatting unchanged.\nOutput ONLY the translated content without meta comments, preamble, or conversational notes.`

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

