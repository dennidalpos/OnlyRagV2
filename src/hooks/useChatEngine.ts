import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { AppSettings, DiagnosticsData, IngestedDocument, ChatMessage, ChatConversation, CitationSource } from '../types'
import { apiService } from '../services/api'
import { logger } from '../lib/logger'
import { getEffectivePrompt } from '../constants/promptConfig'
import { evaluateDomainIntent } from '../services/domainRouter'
import { useIngestedDocuments } from './useIngestedDocuments'
import { resolveChatContextBudget, resolveChatThreadCount, resolvePromptCharBudget } from '../services/chatContextBudget'
import { compactChatHistory } from '../services/chatContextCompactor'
import { extractHardwareFacts } from '../services/hardwareRecommendationEngine'
import { calculateDynamicContextWindow } from '../../electron/core/domain/agent/contextWindowCalculator'
import { normalizeError } from '../lib/errors/errorNormalizer'

const STORAGE_KEY_CONVERSATIONS = 'onlyrag_chat_conversations'
const STORAGE_KEY_ACTIVE_ID = 'onlyrag_chat_active_id'

const createDefaultGreetingMessage = (): ChatMessage => ({
  id: '1',
  sender: 'bot',
  text: 'Hello! I am your local AI RAG Assistant powered by Ollama and LanceDB. Mention `@document_name` or select active context files on the left to chat with your documents.',
  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
})

function loadInitialConversations(): ChatConversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONVERSATIONS)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
      }
    }
  } catch (e) {
    logger.warn('ChatEngine', `Failed loading saved conversations from localStorage: ${e}`)
  }
  const defaultConv: ChatConversation = {
    id: `session-${Date.now()}`,
    title: 'Nuova Conversazione',
    messages: [createDefaultGreetingMessage()],
    selectedDocIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  return [defaultConv]
}

export function useChatEngine(settings: AppSettings, diagnostics: DiagnosticsData | null) {
  // Retrieval context, replayed history and the generation window are all sized from the
  // detected host instead of a single hardcoded budget — see chatContextBudget.ts.
  const hardwareFacts = useMemo(() => extractHardwareFacts(diagnostics), [diagnostics])
  const contextBudget = useMemo(
    () => resolveChatContextBudget(hardwareFacts, settings.hardwareProfile || 'Auto'),
    [hardwareFacts, settings.hardwareProfile]
  )
  const budgetRef = useRef(contextBudget)
  budgetRef.current = contextBudget

  const [isPromptModalOpen, setIsPromptModalOpen] = useState<boolean>(false)
  const [conversations, setConversations] = useState<ChatConversation[]>(loadInitialConversations)
  const [activeConversationId, setActiveConversationId] = useState<string>(() => {
    const initial = loadInitialConversations()
    const savedActiveId = localStorage.getItem(STORAGE_KEY_ACTIVE_ID)
    if (savedActiveId && initial.some((c) => c.id === savedActiveId)) {
      return savedActiveId
    }
    return initial[0]?.id || `session-${Date.now()}`
  })

  const activeConversation = useMemo(() => {
    return conversations.find((c) => c.id === activeConversationId) || conversations[0]
  }, [conversations, activeConversationId])

  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(() => {
    return new Set(activeConversation?.selectedDocIds || [])
  })

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    return activeConversation?.messages?.length > 0 ? activeConversation.messages : [createDefaultGreetingMessage()]
  })

  const handleDocsUpdated = useCallback((docs: IngestedDocument[]) => {
    setSelectedDocIds((prev) => {
      const next = new Set<string>()
      const validIds = new Set(docs.map((d) => d.id))
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id)
      })
      return next
    })
  }, [])

  const { documents, refetchDocuments: fetchDocuments } = useIngestedDocuments({
    onDocsUpdated: handleDocsUpdated,
  })

  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null)

  const [showMentions, setShowMentions] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)

  const chatBottomRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const isGeneratingRef = useRef<boolean>(false)
  const streamThrottleTimer = useRef<any>(null)
  const [autoScroll, setAutoScroll] = useState<boolean>(true)
  const [isScrolledUp, setIsScrolledUp] = useState<boolean>(false)
  const autoScrollRef = useRef<boolean>(true)
  const isScrolledUpRef = useRef<boolean>(false)

  const prevActiveIdRef = useRef<string>(activeConversationId)

  // Persist conversation changes to localStorage safely without race condition on conversation switch
  useEffect(() => {
    // If the conversation ID just changed, do not persist yet — we are loading the target conversation
    if (prevActiveIdRef.current !== activeConversationId) {
      prevActiveIdRef.current = activeConversationId
      return
    }

    if (!activeConversationId) return
    setConversations((prev) => {
      const next = prev.map((conv) => {
        if (conv.id === activeConversationId) {
          return {
            ...conv,
            messages,
            selectedDocIds: Array.from(selectedDocIds),
            updatedAt: new Date().toISOString(),
          }
        }
        return conv
      })
      try {
        localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(next))
        localStorage.setItem(STORAGE_KEY_ACTIVE_ID, activeConversationId)
      } catch (err) {
        logger.warn('ChatEngine', `Failed to persist conversations to localStorage: ${err}`)
      }
      return next
    })
  }, [messages, selectedDocIds, activeConversationId])

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

  const handleSetAutoScroll = useCallback((val: boolean) => {
    autoScrollRef.current = val
    setAutoScroll(val)
    if (val) {
      scrollToBottom(true)
    }
  }, [scrollToBottom])

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

  const handleStopGeneration = useCallback(async () => {
    if (window.electronAPI?.cancelOllamaStream) {
      try {
        await window.electronAPI.cancelOllamaStream()
      } catch (err: any) {
        logger.warn('ChatView', `Failed stopping Ollama stream: ${err.message}`)
      }
    }
    if (streamThrottleTimer.current) {
      clearInterval(streamThrottleTimer.current)
      streamThrottleTimer.current = null
    }
    setIsGenerating(false)
    isGeneratingRef.current = false
  }, [])

  useEffect(() => {
    return () => {
      if (streamThrottleTimer.current) {
        clearInterval(streamThrottleTimer.current)
        streamThrottleTimer.current = null
      }
      if (isGeneratingRef.current && window.electronAPI?.cancelOllamaStream) {
        window.electronAPI.cancelOllamaStream().catch(() => {})
      }
    }
  }, [])

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault()
    }
    if (!input.trim() || isGenerating) return

    const userText = input.trim()
    setInput('')
    setShowMentions(false)

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }

    const botMsgId = (Date.now() + 1).toString()
    const botMsg: ChatMessage = {
      id: botMsgId,
      sender: 'bot',
      text: '',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }

    // Auto-update conversation title on first turn if generic
    setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id === activeConversationId && (conv.title === 'Nuova Conversazione' || conv.title === 'New Chat')) {
          const cleanTitle = userText.length > 36 ? `${userText.slice(0, 33)}...` : userText
          return { ...conv, title: cleanTitle }
        }
        return conv
      })
    )

    const budget = budgetRef.current
    const hasSelectedDocs = selectedDocIds.size > 0

    setMessages((prev) => [...prev, userMsg, botMsg])
    setIsGenerating(true)
    isGeneratingRef.current = true

    // Scroll immediately to show the user's message
    setTimeout(() => scrollToBottom(true), 50)

    try {
      const routingResult = evaluateDomainIntent(userText, settings)
      logger.info('ChatEngine', `Domain Router: ${routingResult.domain.toUpperCase()} -> Model: ${routingResult.modelName} (${routingResult.reason})`)

      let vectorContextText = ''
      let citationSources: CitationSource[] = []
      const scopedDocIds = hasSelectedDocs ? Array.from(selectedDocIds) : undefined

      // Retrieval runs ONLY when documents are explicitly selected and the query is non-chitchat
      if (hasSelectedDocs && routingResult.requiresRetrieval) {
        try {
          const searchResults = await apiService.searchVectorDb(
            userText,
            budget.vectorTopK,
            settings.embeddingModel || 'nomic-embed-text',
            scopedDocIds
          )

          if (Array.isArray(searchResults) && searchResults.length > 0) {
            const validResults = searchResults.filter((res: any) => res && res.text)
            const includedBlocks: string[] = []
            const includedSources: CitationSource[] = []
            let usedChars = 0

            for (let idx = 0; idx < validResults.length; idx++) {
              const res = validResults[idx]
              const block = `[Source ${idx + 1}: ${res.doc_name || 'Document'} | Section: ${res.section_header || 'General'}]\n${res.text}`
              if (includedBlocks.length > 0 && usedChars + block.length > budget.vectorContextChars) break
              includedBlocks.push(block)
              usedChars += block.length
              includedSources.push({
                chunkId: res.chunk_id || '',
                docName: res.doc_name || 'Document',
                sectionHeader: res.section_header || undefined,
                snippet: (res.text || '').slice(0, 150) + (res.text?.length > 150 ? '...' : ''),
                score: res.score || 0,
              })
            }

            vectorContextText = includedBlocks.join('\n\n---\n\n')
            citationSources = includedSources
          }
        } catch (err: any) {
          logger.warn('ChatView', `Vector search non-blocking notice: ${err.message}`)
        }
      }

      // Attach citations to the bot message if available
      if (citationSources.length > 0) {
        setMessages((prev) =>
          prev.map((msg) => (msg.id === botMsgId ? { ...msg, sources: citationSources } : msg))
        )
      }

      const activeDocs = documents.filter((d) => selectedDocIds.has(d.id))
      const directDocsText = activeDocs
        .map((d) => {
          const full = d.extractedMarkdown || ''
          const body = full.slice(0, budget.perDocumentPreviewChars)
          // Say which of the two this actually is. The label used to read 'Full Document' and
          // always ended in '...', so the model was told it held the complete file while holding
          // a truncated head - and then answered that the information was not in the document.
          return body.length === full.length
            ? `[Full Document: ${d.filename}]\n${body}`
            : `[Document Excerpt (first ${body.length} of ${full.length} chars): ${d.filename}]\n${body}\n[...truncated]`
        })
        .join('\n\n---\n\n')

      // Budget the two sources SEPARATELY instead of slicing their concatenation. The slice ran
      // over `vectorContext + separator + directDocs` with the vector text first, so whenever
      // retrieval alone reached totalContextChars the selected document's own text was cut off
      // entirely - the user had attached a file the model then never saw.
      const boundedVectorContext = vectorContextText.slice(0, budget.vectorContextChars)
      const directDocsBudget = Math.max(0, budget.totalContextChars - boundedVectorContext.length)
      const boundedDirectDocs = directDocsText.slice(0, directDocsBudget)
      const boundedContext = [boundedVectorContext, boundedDirectDocs]
        .filter(Boolean)
        .join('\n\n=== ADDITIONAL CONTEXT ===\n\n')

      const modelToUse = routingResult.modelName
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
          // The last sentence is load-bearing. The chat presets used to carry their own bullet
          // scripting the "nothing selected" reply, and llama3.2:3b reached for it even with the
          // document sitting in this very block — 4 refusals out of 4, while the citations panel
          // showed the retrieved excerpts. That bullet is gone from the presets: the only
          // instruction the model now sees is the one matching the state it is actually in.
          `MANDATORY DIRECTIVE: The following excerpts constitute the actual parsed text of the user's selected documents and attachments. You have FULL access to this information. Always search, extract, and cite from this text to accurately answer any user question regarding files, documents, or attachments. A document IS selected and its text is right below: never answer that no document is attached, and never ask the user to select one.\n\n` +
          `${boundedContext}\n` +
          `[END DOCUMENT CONTEXT]`
        : `[ATTACHMENT CONTEXT STATUS]\n` +
          `No documents or attachments are currently selected. If the user asks to analyze, inspect, summarize, or read specific documents, files, logs, or attachments (such as "analizza log" or "riassumi allegato"), inform the user clearly in their language that no attachments are selected, and invite them to select a document from the left sidebar or mention '@filename'. If the question is general knowledge, answer normally.\n` +
          `[END ATTACHMENT CONTEXT STATUS]`

      const promptSections = [
        effectiveSystemPrompt,
        temporalContext,
        docContextBlock,
      ].filter(Boolean)
      const systemPromptWithContext = promptSections.join('\n\n')

      // History is compacted LAST, against whatever the window has left once the system prompt
      // and the selected document context have been placed. It used to be compacted FIRST,
      // against a budget of its own (`maxNumCtx * 2.0` chars) that ignored the rest of the turn:
      // on midrange that reserved 16384 chars for history against 5500 for the documents, and
      // the assembled prompt then filled the window so completely that the answer was left
      // ~1245 tokens to generate into on midrange and 61 on a legacy profile. Placing the
      // attachment first and giving history the remainder inverts that priority: the user picked
      // that document for this question.
      const turnSuffix = `User: ${userText}\nAssistant:`
      const historyBudgetChars = Math.max(
        0,
        resolvePromptCharBudget(budget.maxNumCtx) - systemPromptWithContext.length - turnSuffix.length
      )
      const compactionResult = compactChatHistory(messages, budget, hasSelectedDocs, historyBudgetChars)
      const previousTurns = compactionResult.historyBlock
      if (compactionResult.isCompacted) {
        logger.info(
          'ChatEngine',
          `Conversation history compacted: ${compactionResult.totalOriginalChars} -> ${compactionResult.finalChars} chars (${compactionResult.summarizedTurnsCount} summarized turns, ${compactionResult.verbatimTurnsCount} verbatim turns)`
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
          if (!pendingChunk) return
          pendingChunk = false
          setMessages((prev) =>
            prev.map((msg) => (msg.id === botMsgId ? { ...msg, text: accumulated } : msg))
          )
          if (autoScrollRef.current && !isScrolledUpRef.current) {
            scrollToBottom(false)
          }
        }

        const intervalId = setInterval(flushAccumulatedText, 40)
        streamThrottleTimer.current = intervalId

        try {
          const dynamicNumCtx = calculateDynamicContextWindow(finalPrompt, budget.maxNumCtx)
          logger.info(
            'ChatEngine',
            `Context budget [${budget.profileTier}${budget.isMinimal ? '/minimal' : ''}]: prompt -> num_ctx ${dynamicNumCtx} (max ${budget.maxNumCtx})`
          )

          await window.electronAPI.generateOllamaStream(
            modelToUse,
            finalPrompt,
            (chunk: string) => {
              accumulated += chunk
              pendingChunk = true
            },
            {
              num_ctx: dynamicNumCtx,
              num_thread: resolveChatThreadCount(hardwareFacts.cpuCount),
              keep_alive: budget.keepAlive,
            }
          )
        } finally {
          clearInterval(intervalId)
          streamThrottleTimer.current = null
          // Final flush to guarantee full text is set
          setMessages((prev) =>
            prev.map((msg) => (msg.id === botMsgId ? { ...msg, text: accumulated || 'Risposta completata.' } : msg))
          )
          scrollToBottom(false)
        }
      } else {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === botMsgId ? { ...msg, text: 'Local Ollama API offline or window.electronAPI unattached.' } : msg
          )
        )
      }
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'Chat RAG')
      logger.error('ChatView', `Error during RAG generation: ${normalized.message}`)
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === botMsgId
            ? {
                ...msg,
                text: normalized.remediation
                  ? `${normalized.message}\n\n💡 ${normalized.remediation}`
                  : normalized.message,
              }
            : msg
        )
      )
    } finally {
      setIsGenerating(false)
      isGeneratingRef.current = false
      if (streamThrottleTimer.current) {
        clearInterval(streamThrottleTimer.current)
        streamThrottleTimer.current = null
      }
      setTimeout(() => scrollToBottom(false), 50)
    }
  }

  const loadConversation = useCallback((id: string) => {
    if (isGenerating && window.electronAPI?.cancelOllamaStream) {
      window.electronAPI.cancelOllamaStream().catch(() => {})
    }
    setIsGenerating(false)
    isGeneratingRef.current = false
    const target = conversations.find((c) => c.id === id)
    if (!target) return

    prevActiveIdRef.current = id
    setActiveConversationId(id)
    setMessages(target.messages && target.messages.length > 0 ? target.messages : [createDefaultGreetingMessage()])
    
    // Filter selectedDocIds against valid current documents to prevent orphaned doc selections
    const validDocIds = new Set(documents.map((d) => d.id))
    const filteredSelection = new Set<string>()
    if (documents.length > 0 && target.selectedDocIds) {
      target.selectedDocIds.forEach((docId) => {
        if (validDocIds.has(docId)) filteredSelection.add(docId)
      })
    }
    setSelectedDocIds(filteredSelection)

    setInput('')
    setShowMentions(false)
    try {
      localStorage.setItem(STORAGE_KEY_ACTIVE_ID, id)
    } catch {}
  }, [conversations, documents, isGenerating])

  const handleNewChat = useCallback(() => {
    if (streamThrottleTimer.current) {
      clearInterval(streamThrottleTimer.current)
      streamThrottleTimer.current = null
    }
    if (isGenerating && window.electronAPI?.cancelOllamaStream) {
      window.electronAPI.cancelOllamaStream().catch(() => {})
    }
    setIsGenerating(false)
    isGeneratingRef.current = false
    setInput('')
    setShowMentions(false)
    setSelectedDocIds(new Set())

    const newConv: ChatConversation = {
      id: `session-${Date.now()}`,
      title: 'Nuova Conversazione',
      messages: [createDefaultGreetingMessage()],
      selectedDocIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    prevActiveIdRef.current = newConv.id
    setConversations((prev) => {
      const nextList = [newConv, ...prev]
      try {
        localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(nextList))
      } catch {}
      return nextList
    })
    setActiveConversationId(newConv.id)
    setMessages(newConv.messages)
    try {
      localStorage.setItem(STORAGE_KEY_ACTIVE_ID, newConv.id)
    } catch {}
  }, [isGenerating])

  const deleteConversation = useCallback((id: string) => {
    if (activeConversationId === id) {
      if (streamThrottleTimer.current) {
        clearInterval(streamThrottleTimer.current)
        streamThrottleTimer.current = null
      }
      if (isGenerating && window.electronAPI?.cancelOllamaStream) {
        window.electronAPI.cancelOllamaStream().catch(() => {})
      }
      setIsGenerating(false)
      isGeneratingRef.current = false
      setInput('')
      setShowMentions(false)
    }

    setConversations((prev) => {
      const remaining = prev.filter((c) => c.id !== id)
      let nextList = remaining
      if (remaining.length === 0) {
        const fresh: ChatConversation = {
          id: `session-${Date.now()}`,
          title: 'Nuova Conversazione',
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
        try {
          localStorage.setItem(STORAGE_KEY_ACTIVE_ID, fresh.id)
        } catch {}
      } else if (activeConversationId === id) {
        const nextActive = remaining[0]
        prevActiveIdRef.current = nextActive.id
        setActiveConversationId(nextActive.id)
        setMessages(nextActive.messages && nextActive.messages.length > 0 ? nextActive.messages : [createDefaultGreetingMessage()])
        setSelectedDocIds(new Set(nextActive.selectedDocIds || []))
        try {
          localStorage.setItem(STORAGE_KEY_ACTIVE_ID, nextActive.id)
        } catch {}
      }

      try {
        localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(nextList))
      } catch (err) {
        logger.warn('ChatEngine', `Failed writing updated conversations to localStorage: ${err}`)
      }
      return nextList
    })
  }, [activeConversationId, isGenerating])

  const renameConversation = useCallback((id: string, newTitle: string) => {
    if (!newTitle.trim()) return
    setConversations((prev) => {
      const updated = prev.map((c) => (c.id === id ? { ...c, title: newTitle.trim(), updatedAt: new Date().toISOString() } : c))
      try {
        localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(updated))
      } catch (err) {
        logger.warn('ChatEngine', `Failed writing updated conversations to localStorage: ${err}`)
      }
      return updated
    })
  }, [])

  return {
    isPromptModalOpen,
    setIsPromptModalOpen,
    documents,
    selectedDocIds,
    messages,
    setMessages,
    input,
    setInput,
    isGenerating,
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
