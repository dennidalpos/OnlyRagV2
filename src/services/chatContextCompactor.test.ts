import { describe, it, expect } from 'vitest'
import { compactChatHistory } from './chatContextCompactor'
import type { ChatMessage } from '../types'
import type { ChatContextBudget } from './chatContextBudget'

describe('chatContextCompactor Unit Tests', () => {
  const sampleBudget: ChatContextBudget = {
    profileTier: 'midrange',
    isMinimal: false,
    vectorContextChars: 4000,
    totalContextChars: 5500,
    perDocumentPreviewChars: 1500,
    historyTurns: 6,
    historyChars: 3000,
    vectorTopK: 5,
    maxNumCtx: 8192,
    keepAlive: '30m',
  }

  it('should return empty result when message list only contains generic greeting', () => {
    const messages: ChatMessage[] = [
      { id: '1', sender: 'bot', text: 'Hello! I am your AI Assistant.', timestamp: '12:00' },
    ]
    const res = compactChatHistory(messages, sampleBudget, false)
    expect(res.historyBlock).toBe('')
    expect(res.isCompacted).toBe(false)
  })

  it('should keep 100% full verbatim history when conversation fits within budget', () => {
    const messages: ChatMessage[] = [
      { id: '1', sender: 'bot', text: 'Hello!', timestamp: '12:00' },
      { id: '2', sender: 'user', text: 'Come ti chiami?', timestamp: '12:01' },
      { id: '3', sender: 'bot', text: 'Sono OnlyRag AI.', timestamp: '12:01' },
      { id: '4', sender: 'user', text: 'Che giorno è oggi?', timestamp: '12:02' },
      { id: '5', sender: 'bot', text: 'Oggi è venerdì.', timestamp: '12:02' },
    ]
    const res = compactChatHistory(messages, sampleBudget, false)
    expect(res.isCompacted).toBe(false)
    expect(res.historyBlock).toContain('User: Come ti chiami?')
    expect(res.historyBlock).toContain('Assistant: Sono OnlyRag AI.')
    expect(res.historyBlock).toContain('User: Che giorno è oggi?')
    expect(res.historyBlock).toContain('Assistant: Oggi è venerdì.')
  })

  it('should automatically compact older turns into synopsis when conversation exceeds budget without dropping historical topics', () => {
    const longTurns: ChatMessage[] = [{ id: '1', sender: 'bot', text: 'Hello!', timestamp: '12:00' }]
    for (let i = 1; i <= 20; i++) {
      longTurns.push({ id: `u-${i}`, sender: 'user', text: `Domanda specifica numero ${i} con molti dettagli importanti su argomento ${i}`, timestamp: '12:00' })
      longTurns.push({ id: `b-${i}`, sender: 'bot', text: `Risposta dettagliata numero ${i} con spiegazione tecnica approfondita per argomento ${i}`, timestamp: '12:00' })
    }

    const tightBudget: ChatContextBudget = {
      ...sampleBudget,
      historyChars: 1200,
      maxNumCtx: 1024,
    }

    const res = compactChatHistory(longTurns, tightBudget, true)
    expect(res.isCompacted).toBe(true)
    expect(res.summarizedTurnsCount).toBeGreaterThan(0)
    expect(res.verbatimTurnsCount).toBeGreaterThanOrEqual(2)
    expect(res.historyBlock).toContain('Domanda specifica numero 1')
    expect(res.historyBlock).toContain('Domanda specifica numero 20')
  })
})
