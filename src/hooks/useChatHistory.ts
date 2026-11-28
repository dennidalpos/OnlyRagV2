import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatConversation, ChatMessage } from '../types'
import { loadChatHistory, saveChatHistory, type ChatStorageError } from '../services/chatHistoryStorage'
import { chatHistoryRecoverySchema, chatHistoryStateSchema, recoverInterruptedConversations } from '../../shared/domain/chatHistory'

export function useChatHistory(createGreeting: () => ChatMessage) {
  const [initial] = useState(() => {
    const loaded = loadChatHistory()
    const conversations: ChatConversation[] = loaded.conversations.length
      ? loaded.conversations
      : [
          {
            id: `session-${Date.now()}`,
            title: '',
            messages: [createGreeting()],
            selectedDocIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]
    return { conversations, activeId: conversations.some((c) => c.id === loaded.activeId) ? loaded.activeId! : conversations[0].id, error: loaded.error }
  })
  const [conversations, setConversations] = useState(initial.conversations)
  const [activeConversationId, setActiveConversationId] = useState(initial.activeId)
  const [storageError, setStorageError] = useState<ChatStorageError | null>(initial.error)
  const [ready, setReady] = useState(false)
  const readyRef = useRef(false)
  const blocked = useRef(initial.error !== null)
  const revision = useRef('missing')
  const latest = useRef({ conversations, activeConversationId })
  if (latest.current.conversations !== conversations || latest.current.activeConversationId !== activeConversationId)
    latest.current = { conversations, activeConversationId }
  const confirmed = useRef<typeof latest.current | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chain = useRef<Promise<boolean>>(Promise.resolve(true))
  const mounted = useRef(true)
  const loadEpoch = useRef(0)

  const loadRecovery = useCallback(async () => {
    const epoch = ++loadEpoch.current
    try {
      const recovery = chatHistoryRecoverySchema.parse(await window.electronAPI!.loadChatRecovery())
      if (!mounted.current || epoch !== loadEpoch.current) return
      revision.current = recovery.revision
      if (recovery.state) {
        const restored = recoverInterruptedConversations(recovery.state.conversations)
        latest.current = { conversations: restored, activeConversationId: recovery.state.activeId }
        setConversations(restored)
        setActiveConversationId(recovery.state.activeId)
      }
      setReady(true)
      if (!blocked.current) setStorageError(null)
    } catch {
      if (mounted.current && epoch === loadEpoch.current) setStorageError('load')
    }
  }, [])

  const persist = useCallback(() => {
    const operation = chain.current.then(async () => {
      if (blocked.current || !readyRef.current) return false
      const snapshot = latest.current
      if (confirmed.current === snapshot) return true
      try {
        saveChatHistory(snapshot.conversations, snapshot.activeConversationId)
        const state = chatHistoryStateSchema.parse({ conversations: snapshot.conversations, activeId: snapshot.activeConversationId })
        const saved = chatHistoryRecoverySchema.parse(await window.electronAPI!.saveChatRecovery({ revision: revision.current, state }))
        if (JSON.stringify(saved.state) !== JSON.stringify(state)) throw new Error('Chat checkpoint acknowledgement differs')
        revision.current = saved.revision
        confirmed.current = snapshot
        if (mounted.current && latest.current === snapshot) setStorageError(null)
        return true
      } catch {
        if (mounted.current) setStorageError('save')
        return false
      }
    })
    chain.current = operation
    return operation
  }, [])

  const flushHistory = useCallback(async () => {
    if (!readyRef.current) return true // Bootstrap has accepted no edits.
    do {
      if (!(await persist())) return false
    } while (confirmed.current !== latest.current)
    return true
  }, [persist])

  useEffect(() => {
    // Publish readiness only after React commits the recovered state. A reload during
    // bootstrap must not flush the old local copy over the acknowledged Main snapshot.
    readyRef.current = ready
    if (ready && timer.current === null)
      timer.current = setTimeout(() => {
        timer.current = null
        void persist()
      }, 400)
  }, [conversations, activeConversationId, ready, persist])

  useEffect(() => {
    mounted.current = true
    void loadRecovery()
    const beforeUnload = () => {
      void flushHistory()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      mounted.current = false
      loadEpoch.current++
      window.removeEventListener('beforeunload', beforeUnload)
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
      void flushHistory()
    }
  }, [loadRecovery, flushHistory])

  const retryPersistence = useCallback(async () => {
    if (blocked.current) {
      const loaded = loadChatHistory()
      if (loaded.error) {
        setStorageError(loaded.error)
        return
      }
      blocked.current = false
      const merged = [...new Map([...loaded.conversations, ...latest.current.conversations].map((c) => [c.id, c])).values()]
      latest.current = { ...latest.current, conversations: merged }
      setConversations(merged)
    }
    if (!readyRef.current) await loadRecovery()
    if (readyRef.current) await flushHistory()
  }, [flushHistory, loadRecovery])

  const checkpointConversation = useCallback(
    (id: string, messages: ChatMessage[], selectedDocIds: Set<string>, immediate = false) => {
      const next = latest.current.conversations.map((c) =>
        c.id === id ? { ...c, messages, selectedDocIds: [...selectedDocIds], updatedAt: new Date().toISOString() } : c,
      )
      latest.current = { ...latest.current, conversations: next }
      setConversations(next)
      return immediate ? persist() : Promise.resolve(true)
    },
    [persist],
  )

  return {
    conversations,
    setConversations,
    activeConversationId,
    setActiveConversationId,
    storageError,
    retryPersistence,
    checkpointConversation,
    flushHistory,
    ready,
  }
}
