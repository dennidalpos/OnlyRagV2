import { useState, useRef, useEffect, useCallback } from 'react'
import type { QueuedPromptRecord } from '../types'

export type QueuedPrompt = QueuedPromptRecord

export function useAgentPromptQueue(onNotice?: (message: string) => void) {
  const [promptQueue, setPromptQueue] = useState<QueuedPrompt[]>([])
  const promptQueueRef = useRef<QueuedPrompt[]>([])

  useEffect(() => {
    promptQueueRef.current = promptQueue
  }, [promptQueue])

  const addToPromptQueue = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      const item: QueuedPrompt = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        prompt: trimmed,
        createdAt: new Date().toISOString(),
      }
      setPromptQueue((prev) => [...prev, item])
      if (onNotice) {
        onNotice(`Nuovo prompt aggiunto alla coda (#${promptQueueRef.current.length + 1}): "${trimmed.slice(0, 80)}..."`)
      }
    },
    [onNotice]
  )

  const removeFromPromptQueue = useCallback((id: string) => {
    setPromptQueue((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const editPromptInQueue = useCallback((id: string, newPrompt: string) => {
    const trimmed = newPrompt.trim()
    if (!trimmed) return
    setPromptQueue((prev) =>
      prev.map((p) => (p.id === id ? { ...p, prompt: trimmed } : p))
    )
  }, [])

  const movePromptInQueue = useCallback((fromIndex: number, toIndex: number) => {
    setPromptQueue((prev) => {
      if (toIndex < 0 || toIndex >= prev.length) return prev
      const copy = [...prev]
      const [moved] = copy.splice(fromIndex, 1)
      copy.splice(toIndex, 0, moved)
      return copy
    })
  }, [])

  const dequeueNextPrompt = useCallback((): QueuedPrompt | null => {
    if (promptQueueRef.current.length === 0) return null
    const [nextItem, ...remaining] = promptQueueRef.current
    setPromptQueue(remaining)
    promptQueueRef.current = remaining
    return nextItem
  }, [])

  const clearPromptQueue = useCallback(() => {
    setPromptQueue([])
    promptQueueRef.current = []
  }, [])

  return {
    promptQueue,
    promptQueueRef,
    addToPromptQueue,
    removeFromPromptQueue,
    editPromptInQueue,
    movePromptInQueue,
    dequeueNextPrompt,
    clearPromptQueue,
    setPromptQueue,
  }
}
