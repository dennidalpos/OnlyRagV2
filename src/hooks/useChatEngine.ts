import { useState, useEffect, useRef, useCallback } from 'react'
import { AppSettings, DiagnosticsData, IngestedDocument, ChatMessage, CitationSource } from '../types'
import { apiService } from '../services/api'
import { logger } from '../lib/logger'
import { getEffectivePrompt } from '../components/common/SystemPromptModal'
import { evaluateDomainIntent } from '../services/domainRouter'
import { useIngestedDocuments } from './useIngestedDocuments'

export function useChatEngine(settings: AppSettings, diagnostics: DiagnosticsData | null) {
  const [isPromptModalOpen, setIsPromptModalOpen] = useState<boolean>(false)
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set())

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
    autoRetryIntervalMs: 3000,
  })

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      sender: 'bot',
      text: 'Hello! I am your local AI RAG Assistant powered by Ollama and LanceDB. Mention `@document_name` or select active context files on the left to chat with your documents.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ])
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
  }, [])

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

    // Capture recent history before adding the new user message
    const previousTurns = messages
      .slice(1) // skip generic greeting
      .filter((m) => m.text && m.text.trim())
      .slice(-6) // keep last 6 turns
      .map((m) => `${m.sender === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
      .join('\n\n')

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
      const scopedDocIds = selectedDocIds.size > 0 ? Array.from(selectedDocIds) : undefined

      if (routingResult.requiresRetrieval || (scopedDocIds && scopedDocIds.length > 0)) {
        try {
          const searchResults = await apiService.searchVectorDb(
            userText,
            5,
            settings.embeddingModel || 'nomic-embed-text',
            scopedDocIds
          )

          if (Array.isArray(searchResults) && searchResults.length > 0) {
            vectorContextText = searchResults
              .filter((res: any) => res && res.text)
              .map((res: any, idx: number) => `[Fonte ${idx + 1}: ${res.doc_name || 'Documento'} | Sezione: ${res.section_header || 'Generale'}]\n${res.text}`)
              .join('\n\n---\n\n')

            citationSources = searchResults
              .filter((res: any) => res && res.text)
              .map((res: any) => ({
                chunkId: res.chunk_id || '',
                docName: res.doc_name || 'Document',
                snippet: (res.text || '').slice(0, 150) + (res.text?.length > 150 ? '...' : ''),
                score: res.score || 0,
              }))
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
        .map((d) => `[Documento Completo: ${d.filename}]\n${(d.extractedMarkdown || '').slice(0, 1500)}...`)
        .join('\n\n---\n\n')

      const combinedRawContext = [vectorContextText, directDocsText].filter(Boolean).join('\n\n=== ULTERIORE CONTESTO ===\n\n')
      // Budget context to max 5500 characters to prevent context window overflow
      const boundedContext = combinedRawContext.slice(0, 5500)

      const modelToUse = routingResult.modelName
      const effectivePromptObj = getEffectivePrompt('chat', modelToUse, settings)
      const effectiveSystemPrompt = effectivePromptObj.prompt

      const systemPromptWithContext = boundedContext
        ? `${effectiveSystemPrompt}\n\n[CONTESTO DOCUMENTI INDICIZZATI (LanceDB)]\n${boundedContext}\n[FINE CONTESTO]`
        : effectiveSystemPrompt

      // Assemble full multi-turn prompt
      const promptParts = [systemPromptWithContext]
      if (previousTurns) {
        promptParts.push(`[CRONOLOGIA CONVERSAZIONE]\n${previousTurns}\n[FINE CRONOLOGIA]`)
      }
      promptParts.push(`User: ${userText}\nAssistant:`)
      const finalPrompt = promptParts.join('\n\n')

      if (window.electronAPI?.generateOllamaStream) {
        let accumulated = ''
        let pendingChunk = false

        // Throttled UI updater for smooth 60fps streaming without locking Electron compositor
        const flushAccumulatedText = () => {
          if (!pendingChunk) return
          pendingChunk = false
          setMessages((prev) =>
            prev.map((msg) => (msg.id === botMsgId ? { ...msg, text: accumulated } : msg))
          )
          scrollToBottom(false)
        }

        const intervalId = setInterval(flushAccumulatedText, 40)
        streamThrottleTimer.current = intervalId

        try {
          await window.electronAPI.generateOllamaStream(
            modelToUse,
            finalPrompt,
            (chunk: string) => {
              accumulated += chunk
              pendingChunk = true
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
    } catch (err: any) {
      logger.error('ChatView', `Error during RAG generation: ${err.message}`)
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === botMsgId
            ? {
                ...msg,
                text: `Errore durante la connessione con Ollama LLM: ${err.message}. Verifica che Ollama sia attivo su http://localhost:11434.`,
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

  const handleNewChat = () => {
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
    setMessages([
      {
        id: Date.now().toString(),
        sender: 'bot',
        text: 'Hello! I am your local AI RAG Assistant powered by Ollama and LanceDB. Mention `@document_name` or select active context files on the left to chat with your documents.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ])
  }

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
    scrollToBottom,
    fetchDocuments,
    toggleDocSelection,
    handleInputChange,
    selectMentionDoc,
    handleCopyMessage,
    handleSendMessage,
    handleStopGeneration,
    handleNewChat,
  }
}

