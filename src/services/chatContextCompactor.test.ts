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

  describe('explicit history budget (regression: attachments squeezed out of the context window)', () => {
    const buildLongConversation = (): ChatMessage[] => {
      const turns: ChatMessage[] = []
      for (let i = 0; i < 12; i++) {
        turns.push({ id: `u${i}`, sender: 'user', text: 'D'.repeat(600), timestamp: '12:00' })
        turns.push({ id: `b${i}`, sender: 'bot', text: 'R'.repeat(600), timestamp: '12:00' })
      }
      return turns
    }

    it('should honour an explicit availableChars budget instead of its own maxNumCtx-derived one', () => {
      const turns = buildLongConversation()

      // Its own fallback allows max(3000, 8192 * 2.0) = 16384 chars for history ALONE, which is
      // what crowded the user's selected document out of an 8192-token window.
      const fallback = compactChatHistory(turns, sampleBudget, true)
      const scoped = compactChatHistory(turns, sampleBudget, true, 2000)

      expect(fallback.isCompacted).toBe(false)
      expect(scoped.isCompacted).toBe(true)
      expect(scoped.finalChars).toBeLessThan(fallback.finalChars)
    })

    it('should never exceed the caller budget, even when the turns cannot be summarized', () => {
      // Structureless text (logs, tables, code) gives TextRankSummarizer nothing to cut, and the
      // recent-turn loop always keeps the last 4 turns. Without the final clamp the block stayed
      // at full size and pushed the document context out of the window anyway.
      const turns = buildLongConversation()
      for (const availableChars of [8000, 2000, 500, 0]) {
        const res = compactChatHistory(turns, sampleBudget, true, availableChars)
        expect(
          res.historyBlock.length,
          `history block overflowed a ${availableChars}-char budget`
        ).toBeLessThanOrEqual(availableChars + 80)
      }
    })

    it('should keep the MOST RECENT turns when it has to trim', () => {
      const turns: ChatMessage[] = [
        { id: 'u1', sender: 'user', text: 'OLDEST-MARKER '.repeat(80), timestamp: '12:00' },
        { id: 'b1', sender: 'bot', text: 'old reply '.repeat(80), timestamp: '12:00' },
        { id: 'u2', sender: 'user', text: 'NEWEST-MARKER '.repeat(20), timestamp: '12:05' },
        { id: 'b2', sender: 'bot', text: 'new reply '.repeat(20), timestamp: '12:05' },
      ]
      const res = compactChatHistory(turns, sampleBudget, true, 600)
      expect(res.historyBlock).toContain('NEWEST-MARKER')
      expect(res.historyBlock.length).toBeLessThanOrEqual(680)
    })
  })
})
