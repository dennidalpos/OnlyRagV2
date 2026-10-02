import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { AppSettings, DiagnosticsData, IngestedDocument, ChatMessage, ChatConversation, CitationSource } from '../types'
import { electronApi } from '../services/electronApi'
import { logger } from '../lib/logger'
import { getEffectivePrompt } from '../constants/promptConfig'
import { evaluateDomainIntent } from '../services/domainRouter'
import { useIngestedDocuments } from './useIngestedDocuments'
import { useTranslation } from '../i18n'
import { resolveChatContextBudget, resolveChatThreadCount, resolvePromptCharBudget } from '../services/chatContextBudget'
import { compactChatHistory } from '../services/chatContextCompactor'
import { extractHardwareFacts } from '../services/hardwareRecommendationEngine'
import { normalizeError } from '../lib/errors/errorNormalizer'
import { resolveModelContextLength } from '../../shared/domain/settings/modelContextPreference'
import { resolveMaxContextTokens } from '../../shared/domain/hardware/hardwareProfileTiers'
import { useOllamaModelMetrics } from './useOllamaModelMetrics'
import { useOllamaGenerationState } from './useOllamaGenerationState'
import { chosenThinkValue, resolveOllamaThinkingPreference } from '../../shared/domain/agent/ollamaThinkingPolicy'
import { noConfiguredModelMessage, resolveConfiguredModel } from '../../shared/domain/settings/configuredModel'
import { errorMessage } from '../../shared/domain/errors/errorMessage'
import { useChatHistory } from './useChatHistory'
import { citationForSuppliedPassage, resolveAnswerReferences } from '../services/chatSourceReferences'

interface ChatRun {
  id: string
  conversationId: string
  docIds: Set<string>
  botMsgId: string
  text: string
  dispatched: boolean
}

const createDefaultGreetingMessage = (): ChatMessage => ({
  id: '1',
  sender: 'bot',
  text: 'Hello! I am your local AI RAG Assistant powered by Ollama and LanceDB. Mention `@document_name` or select active context files on the left to chat with your documents.',
  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
})

/** An untitled conversation stores an empty title; the view shows the localized default for it. */
export function isUntitledConversationTitle(title: string | undefined): boolean {
  return !(title ?? '').trim()
}

export function useChatEngine(settings: AppSettings, diagnostics: DiagnosticsData | null) {
  const { t } = useTranslation()
  // Use the effective model window and detected hardware for context budgets.
  const hardwareFacts = useMemo(() => extractHardwareFacts(diagnostics), [diagnostics])
  const hardwareDefault = useMemo(() => resolveMaxContextTokens('Auto', hardwareFacts), [hardwareFacts])
  const { metrics: modelMetrics } = useOllamaModelMetrics(settings.ollamaHost)
  const selectedModel = resolveConfiguredModel('chat', settings)
  const contextBudget = useMemo(
    () =>
      resolveChatContextBudget(
        hardwareFacts,
        'Auto',
        resolveModelContextLength(selectedModel, settings.modelContextLengths, hardwareDefault, modelMetrics[selectedModel]?.contextLength),
      ),
    [hardwareFacts, hardwareDefault, modelMetrics, selectedModel, settings.modelContextLengths],
  )
  const budgetRef = useRef(contextBudget)
  budgetRef.current = contextBudget

  const [isPromptModalOpen, setIsPromptModalOpen] = useState<boolean>(false)
  const { conversations, setConversations, activeConversationId, setActiveConversationId, storageError, retryPersistence } =
    useChatHistory(createDefaultGreetingMessage)

  const activeConversation = useMemo(() => {
    return conversations.find((c) => c.id === activeConversationId) || conversations[0]
  }, [conversations, activeConversationId])

  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(() => {
    return new Set(activeConversation?.selectedDocIds || [])
  })

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    return activeConversation?.messages?.length > 0 ? activeConversation.messages : [createDefaultGreetingMessage()]
  })
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const { documents, refetchDocuments: fetchDocuments } = useIngestedDocuments()

  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const { generationState, trackOperation } = useOllamaGenerationState()
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null)

  const [showMentions, setShowMentions] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)

  const chatBottomRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const isGeneratingRef = useRef<boolean>(false)
  const activeRunRef = useRef<ChatRun | null>(null)
  const streamThrottleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [autoScroll, setAutoScroll] = useState<boolean>(true)
  const [isScrolledUp, setIsScrolledUp] = useState<boolean>(false)
  const autoScrollRef = useRef<boolean>(true)
  const isScrolledUpRef = useRef<boolean>(false)

  const prevActiveIdRef = useRef<string>(activeConversationId)

  const persistConversationState = useCallback((msgs: ChatMessage[], docIds: Set<string>, convId: string) => {
    if (!convId) return
    setConversations((prev) => {
      const next = prev.map((conv) => {
        if (conv.id === convId) {
          return {
            ...conv,
            messages: msgs,
            selectedDocIds: Array.from(docIds),
            updatedAt: new Date().toISOString(),
          }
        }
        return conv
      })
      return next
    })
  }, [])

  const updateRunMessage = useCallback((run: ChatRun, text: string, sources?: CitationSource[], invalidSourceReferences?: string[]) => {
    if (activeRunRef.current !== run) return
    run.text = text
    const next = messagesRef.current.map((msg) =>
      msg.id === run.botMsgId ? { ...msg, text, ...(sources ? { sources } : {}), ...(invalidSourceReferences ? { invalidSourceReferences } : {}) } : msg,
    )
    messagesRef.current = next
    setMessages(next)
  }, [])

  const settleRun = useCallback(
    (run: ChatRun) => {
      if (activeRunRef.current !== run) return
      activeRunRef.current = null
      if (streamThrottleTimer.current) {
        clearInterval(streamThrottleTimer.current)
        streamThrottleTimer.current = null
      }
      isGeneratingRef.current = false
      setIsGenerating(false)
      trackOperation(null)
      persistConversationState(messagesRef.current, run.docIds, run.conversationId)
    },
    [persistConversationState, trackOperation],
  )

  const cancelActiveRun = useCallback(async () => {
    const run = activeRunRef.current
    if (!run) return
    updateRunMessage(run, run.text ? `${run.text}\n\n${t('chat.generationStopped')}` : t('chat.generationStopped'))
    // Invalidate locally before awaiting Main; late callbacks cannot own a newer run.
    settleRun(run)
    if (run.dispatched && window.electronAPI?.cancelOllamaStream) {
      try {
        await window.electronAPI.cancelOllamaStream({ operationId: run.id })
      } catch (err: unknown) {
        logger.warn('ChatView', `Failed stopping Ollama stream: ${errorMessage(err)}`)
      }
    }
  }, [settleRun, updateRunMessage, t])

  // Keep streamed tokens out of the persistent history until the response settles.
  useEffect(() => {
    // Do not persist the previous conversation into the newly selected one.
    if (prevActiveIdRef.current !== activeConversationId) {
      prevActiveIdRef.current = activeConversationId
      return
    }

    if (!activeConversationId) return

    if (isGeneratingRef.current) return

    persistConversationState(messages, selectedDocIds, activeConversationId)
  }, [messages, selectedDocIds, activeConversationId, persistConversationState])

  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current
    const isUp = scrollHeight - scrollTop - clientHeight > 80
    isScrolledUpRef.current = isUp
    setIsScrolledUp(isUp)
  }, [])

  const scrollToBottom = useCallback((smooth = false) => {
    if (messagesContainerRef.current) {
      if (smooth) {
        messagesContainerRef.current.scrollTo({
          top: messagesContainerRef.current.scrollHeight,
          behavior: 'smooth',
        })
      } else {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
      }
    } else if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'nearest' })
    }
    isScrolledUpRef.current = false
    setIsScrolledUp(false)
  }, [])

  const handleSetAutoScroll = useCallback(
    (val: boolean) => {
      autoScrollRef.current = val
      setAutoScroll(val)
      if (val) {
        scrollToBottom(true)
      }
    },
    [scrollToBottom],
  )

  // Reactive autoscroll effect on every message state update
  useEffect(() => {
    if (autoScrollRef.current && !isScrolledUpRef.current) {
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
      } else if (chatBottomRef.current) {
        chatBottomRef.current.scrollIntoView({ behavior: 'auto', block: 'nearest' })
      }
    }
  }, [messages, isGenerating])

  const toggleDocSelection = (id: string) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setInput(val)

    const lastAtPos = val.lastIndexOf('@')
    if (lastAtPos !== -1 && lastAtPos >= val.length - 20) {
      const query = val.slice(lastAtPos + 1).toLowerCase()
      setMentionFilter(query)
      setShowMentions(true)
      setMentionIndex(lastAtPos)
    } else {
      setShowMentions(false)
    }
  }

  const selectMentionDoc = (doc: IngestedDocument) => {
    const beforeAt = input.slice(0, mentionIndex)
    setInput(`${beforeAt}@${doc.filename} `)
    toggleDocSelection(doc.id)
    setShowMentions(false)
  }

  const filteredMentions = documents.filter((d) => (d.filename || '').toLowerCase().includes(mentionFilter))

  const handleCopyMessage = (msgId: string, text: string) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedMsgId(msgId)
    setTimeout(() => setCopiedMsgId(null), 2000)
  }

  const handleStopGeneration = cancelActiveRun

  useEffect(() => {
    return () => {
      const run = activeRunRef.current
      activeRunRef.current = null
      if (streamThrottleTimer.current) {
        clearInterval(streamThrottleTimer.current)
        streamThrottleTimer.current = null
      }
      if (run?.dispatched && window.electronAPI?.cancelOllamaStream) {
        window.electronAPI.cancelOllamaStream({ operationId: run.id }).catch((err: unknown) => {
          logger.warn('ChatView', `Failed cancelling unmounted chat: ${errorMessage(err)}`)
        })
      }
    }
  }, [])

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault()
    }
    if (!input.trim() || isGeneratingRef.current) return

    const userText = input.trim()
    const operationId = crypto.randomUUID()
    const run: ChatRun = {
      id: operationId,
      conversationId: activeConversationId,
      docIds: new Set(selectedDocIds),
      botMsgId: `${operationId}:bot`,
      text: '',
      dispatched: false,
    }
    activeRunRef.current = run
    const isCurrentRun = () => activeRunRef.current === run
    setInput('')
    setShowMentions(false)

    const userMsg: ChatMessage = {
      id: `${operationId}:user`,
      sender: 'user',
      text: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }

    const botMsgId = run.botMsgId
    const botMsg: ChatMessage = {
      id: botMsgId,
      sender: 'bot',
      text: '',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }

    // Auto-update conversation title on first turn if generic
    setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id === activeConversationId && isUntitledConversationTitle(conv.title)) {
          const cleanTitle = userText.length > 36 ? `${userText.slice(0, 33)}...` : userText
          return { ...conv, title: cleanTitle }
        }
        return conv
      }),
    )

    const budget = budgetRef.current
    const hasSelectedDocs = run.docIds.size > 0

    messagesRef.current = [...messagesRef.current, userMsg, botMsg]
    setMessages(messagesRef.current)
    setIsGenerating(true)
    isGeneratingRef.current = true

    // Scroll immediately to show the user's message
    setTimeout(() => {
      if (isCurrentRun()) scrollToBottom(true)
    }, 50)

    try {
      const routingResult = evaluateDomainIntent(userText, settings)
      logger.info('ChatEngine', `Domain Router: ${routingResult.domain.toUpperCase()} -> Model: ${routingResult.modelName} (${routingResult.reason})`)

      let vectorContextText = ''
      let citationSources: CitationSource[] = []
      const groundingFailures: string[] = []
      let contextNotice = ''
      const scopedDocIds = hasSelectedDocs ? Array.from(run.docIds) : undefined

      // Retrieval runs ONLY when documents are explicitly selected and the query is non-chitchat
      if (hasSelectedDocs && routingResult.requiresRetrieval) {
        try {
          const searchResults = await electronApi().searchVectorDb({ query: userText, topK: budget.vectorTopK, docIds: scopedDocIds })
          if (!isCurrentRun()) return

          if (!Array.isArray(searchResults)) throw new Error('Invalid retrieval response')
          if (searchResults.length > 0) {
            const validResults = searchResults.filter((res) => res && res.text && (!res.doc_id || run.docIds.has(res.doc_id)))
            const includedBlocks: string[] = []
            const includedSources: CitationSource[] = []
            let usedChars = 0

            for (let idx = 0; idx < validResults.length; idx++) {
              const res = validResults[idx]
              const referenceId = `S${idx + 1}`
              const header = `[${referenceId}: ${res.doc_name || 'Document'} | Section: ${res.section_header || 'General'}]\n`
              const separatorChars = includedBlocks.length > 0 ? 7 : 0
              const availableChars = budget.vectorContextChars - usedChars - separatorChars - header.length
              if (availableChars <= 0) break
              const body = res.text.slice(0, availableChars).replace(/[\uD800-\uDBFF]$/, '')
              const block = header + body
              includedBlocks.push(block)
              usedChars += block.length + separatorChars
              includedSources.push(citationForSuppliedPassage(res, body, referenceId))
            }

            vectorContextText = includedBlocks.join('\n\n---\n\n')
            citationSources = includedSources
          }
        } catch (err: unknown) {
          if (!isCurrentRun()) return
          logger.warn('ChatView', `Vector search failed: ${errorMessage(err)}`)
          groundingFailures.push(t('chat.groundingSearchFailed'))
        }
      }

      const activeDocTexts: { name: string; full: string }[] = []
      if (hasSelectedDocs) {
        // Fresh metadata and content detect deletion; cached Markdown is not proof of availability.
        try {
          const currentDocs = await electronApi().getIngestedDocuments()
          if (!isCurrentRun()) return
          if (!currentDocs) throw new Error('Document list unavailable')
          const selectedDocs: IngestedDocument[] = []
          for (const id of run.docIds) {
            const doc = currentDocs.find((item) => item.id === id)
            if (doc) selectedDocs.push(doc)
            else groundingFailures.push(t('chat.groundingDeleted', { name: documents.find((item) => item.id === id)?.filename || id }))
          }
          const loaded = await Promise.allSettled(selectedDocs.map((doc) => electronApi().getIngestedDocument({ docId: doc.id })))
          if (!isCurrentRun()) return
          loaded.forEach((result, index) => {
            const name = selectedDocs[index].filename
            if (result.status === 'rejected' || !result.value) {
              groundingFailures.push(t('chat.groundingUnavailable', { name }))
            } else if (!result.value.extractedMarkdown?.trim()) {
              groundingFailures.push(t('chat.groundingEmpty', { name }))
            } else {
              activeDocTexts.push({ name, full: result.value.extractedMarkdown })
            }
          })
        } catch (err: unknown) {
          if (!isCurrentRun()) return
          logger.warn('ChatView', `Document context unavailable: ${errorMessage(err)}`)
          groundingFailures.push(t('chat.groundingListFailed'))
        }
        if (groundingFailures.length > 0) {
          const text = t('chat.groundingBlocked', { loaded: activeDocTexts.length, total: run.docIds.size, details: groundingFailures.join('\n') })
          updateRunMessage(run, text)
          return
        }
      }

      const contextSeparator = '\n\n=== ADDITIONAL CONTEXT ===\n\n'
      let remainingChars = Math.max(0, budget.totalContextChars - vectorContextText.length - (vectorContextText ? contextSeparator.length : 0))
      const documentBlocks: string[] = []
      const partialDocs: string[] = []
      for (const { name, full } of activeDocTexts) {
        const separatorChars = documentBlocks.length > 0 ? 7 : 0
        const fullHeader = `[Full Document: ${name}]\n`
        const excerptHeader = `[Document Excerpt: ${name} | original ${full.length} chars; incomplete]\n`
        const complete = full.length <= budget.perDocumentPreviewChars && fullHeader.length + full.length + separatorChars <= remainingChars
        const header = complete ? fullHeader : excerptHeader
        const body = full.slice(0, Math.min(budget.perDocumentPreviewChars, Math.max(0, remainingChars - separatorChars - header.length)))
        if (!complete) partialDocs.push(name)
        if (!body.trim()) continue
        const block = header + body
        documentBlocks.push(block)
        remainingChars -= block.length + separatorChars
      }
      if (partialDocs.length > 0) contextNotice = t('chat.groundingPartial', { names: partialDocs.join(', ') }) + '\n\n'
      const boundedContext = [vectorContextText, documentBlocks.join('\n\n---\n\n')].filter(Boolean).join(contextSeparator)
      if (hasSelectedDocs && !boundedContext.trim()) throw new Error(t('chat.groundingNoContext'))
      if (citationSources.length > 0 || contextNotice) {
        updateRunMessage(run, contextNotice, citationSources)
      }

      const modelToUse = routingResult.modelName
      if (!modelToUse) throw new Error(noConfiguredModelMessage('chat'))
      const effectiveSystemPrompt = getEffectivePrompt('chat', settings).prompt

      const now = new Date()
      const formattedDate = now.toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
      const formattedTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      const temporalContext = `[TEMPORAL CONTEXT]\nCurrent system date and time: ${now.toISOString().split('T')[0]} (${formattedDate}, ${formattedTime})\nAlways use this temporal information to accurately answer any questions regarding the current date, time, day of the week, month, or year.`

      const docContextBlock = boundedContext
        ? `[INDEXED DOCUMENT CONTEXT (LanceDB)]\n` +
          `Use only the document text supplied below for document claims. Retrieved passages are candidates, not verified support. An excerpt is incomplete: do not claim access to omitted text or complete-document coverage. If the supplied text does not support the answer, say so.\n` +
          `Cite each supported document claim immediately with its supplied passage reference, such as [S1]. Use only references supplied in this turn. Do not cite a passage that does not support the claim, and do not invent references for document previews.\n` +
          `If a sentence combines facts from multiple passages, cite every needed reference next to that sentence. Keep citations beside their claims, rather than in a separate final list.\n` +
          (partialDocs.length > 0 ? `Incomplete or omitted document previews: ${partialDocs.join(', ')}.\n` : '') +
          '\n' +
          `${boundedContext}\n` +
          `[END DOCUMENT CONTEXT]`
        : `[ATTACHMENT CONTEXT STATUS]\n` +
          `No documents or attachments are currently selected. If the user asks to analyze, inspect, summarize, or read specific documents, files, logs, or attachments (such as "analizza log" or "riassumi allegato"), inform the user clearly in their language that no attachments are selected, and invite them to select a document from the left sidebar or mention '@filename'. If the question is general knowledge, answer normally.\n` +
          `[END ATTACHMENT CONTEXT STATUS]`

      const promptSections = [effectiveSystemPrompt, temporalContext, docContextBlock].filter(Boolean)
      const systemPromptWithContext = promptSections.join('\n\n')

      // Compact history into the space left by instructions and document context.
      const turnSuffix = `User: ${userText}\nAssistant:`
      const historyBudgetChars = Math.max(0, resolvePromptCharBudget(budget.maxNumCtx) - systemPromptWithContext.length - turnSuffix.length)
      const compactionResult = compactChatHistory(messages, budget, hasSelectedDocs, historyBudgetChars)
      const previousTurns = compactionResult.historyBlock
      if (compactionResult.isCompacted) {
        logger.info(
          'ChatEngine',
          `Conversation history compacted: ${compactionResult.totalOriginalChars} -> ${compactionResult.finalChars} chars (${compactionResult.summarizedTurnsCount} summarized turns, ${compactionResult.verbatimTurnsCount} verbatim turns)`,
        )
      }

      // Assemble full multi-turn prompt in standard conversational format
      const promptParts = [systemPromptWithContext]
      if (previousTurns) {
        promptParts.push(previousTurns)
      }
      promptParts.push(turnSuffix)
      const finalPrompt = promptParts.join('\n\n')

      if (window.electronAPI?.generateOllamaStream) {
        let accumulated = ''
        let pendingChunk = false

        const flushAccumulatedText = () => {
          if (!isCurrentRun() || !pendingChunk) return
          pendingChunk = false
          updateRunMessage(run, contextNotice + accumulated)
          if (autoScrollRef.current && !isScrolledUpRef.current) {
            scrollToBottom(false)
          }
        }

        const intervalId = setInterval(flushAccumulatedText, 40)
        streamThrottleTimer.current = intervalId
        trackOperation(operationId)

        try {
          logger.info('ChatEngine', `Context budget [${budget.profileTier}${budget.isMinimal ? '/minimal' : ''}]: selected num_ctx ${budget.maxNumCtx}`)

          if (!isCurrentRun()) return
          run.dispatched = true
          const result = await window.electronAPI.generateOllamaStream(
            {
              model: modelToUse,
              prompt: finalPrompt,
              options: {
                num_ctx: budget.maxNumCtx,
                num_thread: resolveChatThreadCount(hardwareFacts.cpuCount),
                keep_alive: budget.keepAlive,
                think: chosenThinkValue(resolveOllamaThinkingPreference(modelToUse, settings, modelMetrics)),
              },
              host: settings.ollamaHost,
              operationId,
            },
            (chunk: string) => {
              if (!isCurrentRun()) return
              accumulated += chunk
              run.text = contextNotice + accumulated
              pendingChunk = true
            },
          )
          if (!isCurrentRun()) return
          if (!result.success) throw new Error(result.error || 'Ollama generation failed.')
          if (!accumulated.trim()) throw new Error('Ollama returned an empty response.')
          const references = resolveAnswerReferences(accumulated, citationSources)
          updateRunMessage(run, contextNotice + accumulated, references.sources, references.invalidSourceReferences)
        } finally {
          clearInterval(intervalId)
          if (isCurrentRun()) {
            streamThrottleTimer.current = null
            updateRunMessage(run, contextNotice + accumulated)
            scrollToBottom(false)
          }
        }
      } else {
        updateRunMessage(run, 'Local Ollama API offline or window.electronAPI unattached.')
      }
    } catch (err: unknown) {
      if (!isCurrentRun()) return
      const normalized = normalizeError(err, 'Chat RAG')
      logger.error('ChatView', `Error during RAG generation: ${normalized.message}`)
      updateRunMessage(run, normalized.remediation ? `${normalized.message}\n\n💡 ${normalized.remediation}` : normalized.message)
    } finally {
      if (isCurrentRun()) {
        settleRun(run)
        scrollToBottom(false)
      }
    }
  }

  const loadConversation = useCallback(
    (id: string) => {
      if (id === activeConversationId) return
      const target = conversations.find((c) => c.id === id)
      if (!target) return
      void cancelActiveRun()
      persistConversationState(messagesRef.current, selectedDocIds, activeConversationId)

      prevActiveIdRef.current = id
      setActiveConversationId(id)
      setMessages(target.messages && target.messages.length > 0 ? target.messages : [createDefaultGreetingMessage()])

      setSelectedDocIds(new Set(target.selectedDocIds || []))

      setInput('')
      setShowMentions(false)
    },
    [conversations, selectedDocIds, activeConversationId, persistConversationState, setActiveConversationId, cancelActiveRun],
  )

  const handleNewChat = useCallback(() => {
    void cancelActiveRun()
    persistConversationState(messagesRef.current, selectedDocIds, activeConversationId)
    setInput('')
    setShowMentions(false)
    setSelectedDocIds(new Set())

    const newConv: ChatConversation = {
      id: `session-${crypto.randomUUID()}`,
      title: '',
      messages: [createDefaultGreetingMessage()],
      selectedDocIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    prevActiveIdRef.current = newConv.id
    setConversations((prev) => [newConv, ...prev])
    setActiveConversationId(newConv.id)
    setMessages(newConv.messages)
  }, [selectedDocIds, activeConversationId, persistConversationState, setConversations, setActiveConversationId, cancelActiveRun])

  const deleteConversation = useCallback(
    (id: string) => {
      if (activeConversationId === id) {
        void cancelActiveRun()
        setInput('')
        setShowMentions(false)
      }

      setConversations((prev) => {
        const remaining = prev.filter((c) => c.id !== id)
        let nextList = remaining
        if (remaining.length === 0) {
          const fresh: ChatConversation = {
            id: `session-${crypto.randomUUID()}`,
            title: '',
            messages: [createDefaultGreetingMessage()],
            selectedDocIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
          prevActiveIdRef.current = fresh.id
          setActiveConversationId(fresh.id)
          setMessages(fresh.messages)
          setSelectedDocIds(new Set())
          nextList = [fresh]
        } else if (activeConversationId === id) {
          const nextActive = remaining[0]
          prevActiveIdRef.current = nextActive.id
          setActiveConversationId(nextActive.id)
          setMessages(nextActive.messages && nextActive.messages.length > 0 ? nextActive.messages : [createDefaultGreetingMessage()])
          setSelectedDocIds(new Set(nextActive.selectedDocIds || []))
        }

        return nextList
      })
    },
    [activeConversationId, cancelActiveRun, setActiveConversationId, setConversations],
  )

  const renameConversation = useCallback((id: string, newTitle: string) => {
    if (!newTitle.trim()) return
    setConversations((prev) => {
      const updated = prev.map((c) => (c.id === id ? { ...c, title: newTitle.trim(), updatedAt: new Date().toISOString() } : c))
      return updated
    })
  }, [])

  return {
    storageError,
    retryPersistence,
    isPromptModalOpen,
    setIsPromptModalOpen,
    documents,
    selectedDocIds,
    messages,
    setMessages,
    input,
    setInput,
    isGenerating,
    generationState,
    copiedMsgId,
    showMentions,
    mentionFilter,
    filteredMentions,
    chatBottomRef,
    messagesContainerRef,
    autoScroll,
    setAutoScroll: handleSetAutoScroll,
    isScrolledUp,
    handleScroll,
    scrollToBottom,
    fetchDocuments,
    toggleDocSelection,
    handleInputChange,
    selectMentionDoc,
    handleCopyMessage,
    handleSendMessage,
    handleStopGeneration,
    handleNewChat,
    contextBudget,
    conversations,
    activeConversationId,
    loadConversation,
    deleteConversation,
    renameConversation,
  }
}
