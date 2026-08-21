import type { ChatMessage } from '../types'
import type { ChatContextBudget } from './chatContextBudget'
import { TextRankSummarizer } from '../../electron/core/domain/nlp/textRankSummarizer'

export interface ChatCompactionResult {
  historyBlock: string
  isCompacted: boolean
  summarizedTurnsCount: number
  verbatimTurnsCount: number
  totalOriginalChars: number
  finalChars: number
}

/**
 * Distills an older chat turn using TextRank NLP graph-based extractive summarization.
 */
function distillTurn(userText: string, botText: string, turnIndex: number): string {
  const cleanUser = (userText || '').replace(/\s+/g, ' ').trim()
  const cleanBot = (botText || '').replace(/\s+/g, ' ').trim()

  const summarizedUser = cleanUser.length > 150
    ? TextRankSummarizer.summarize(cleanUser, { targetSentences: 1 }) || cleanUser.slice(0, 140)
    : cleanUser

  const summarizedBot = cleanBot.length > 200
    ? TextRankSummarizer.summarize(cleanBot, { targetSentences: 1 }) || cleanBot.slice(0, 190)
    : cleanBot

  return `• Turno ${turnIndex} - Utente: "${summarizedUser}" -> Assistente: "${summarizedBot}"`
}

/**
 * Automatically compacts chat history based on dynamic hardware budget without hardcoded turn dropping.
 * Preserves 100% of historical turns through rolling semantic synopsis when total dialogue exceeds available budget.
 */
export function compactChatHistory(
  messages: ChatMessage[],
  budget: ChatContextBudget,
  hasSelectedDocs: boolean
): ChatCompactionResult {
  // Filter out system greetings or empty messages
  const dialogueMessages = messages
    .slice(1)
    .filter((m) => m.text && m.text.trim())

  if (dialogueMessages.length === 0) {
    return {
      historyBlock: '',
      isCompacted: false,
      summarizedTurnsCount: 0,
      verbatimTurnsCount: 0,
      totalOriginalChars: 0,
      finalChars: 0,
    }
  }

  // Calculate dynamic character budget for history:
  // When no documents are selected, the model's full context window (minus system prompt ~2500 chars) is available.
  const baseBudget = hasSelectedDocs
    ? budget.historyChars
    : Math.max(budget.historyChars, Math.floor(budget.maxNumCtx * 3.2 - 2500))

  // Group messages into user-assistant pairs
  const turnPairs: { user: string; assistant: string; userMsgId: string; assistantMsgId?: string }[] = []
  let currentTurn: { user: string; assistant: string; userMsgId: string; assistantMsgId?: string } | null = null

  for (const msg of dialogueMessages) {
    if (msg.sender === 'user') {
      if (currentTurn) turnPairs.push(currentTurn)
      currentTurn = { user: msg.text, assistant: '', userMsgId: msg.id }
    } else if (msg.sender === 'bot' && currentTurn) {
      currentTurn.assistant = msg.text
      currentTurn.assistantMsgId = msg.id
      turnPairs.push(currentTurn)
      currentTurn = null
    }
  }
  if (currentTurn) {
    turnPairs.push(currentTurn)
  }

  // Build full uncompacted dialogue
  const fullDialogue = turnPairs
    .map((t) => (t.assistant ? `User: ${t.user}\nAssistant: ${t.assistant}` : `User: ${t.user}`))
    .join('\n\n')

  const totalOriginalChars = fullDialogue.length

  // If full dialogue fits comfortably within the budget, return 100% full verbatim history
  if (totalOriginalChars <= baseBudget) {
    return {
      historyBlock: fullDialogue,
      isCompacted: false,
      summarizedTurnsCount: 0,
      verbatimTurnsCount: turnPairs.length,
      totalOriginalChars,
      finalChars: totalOriginalChars,
    }
  }

  // If over budget, dynamically split between summarized older turns and verbatim recent turns
  const recentBudget = Math.floor(baseBudget * 0.65)
  const recentTurns: typeof turnPairs = []
  let recentChars = 0

  for (let i = turnPairs.length - 1; i >= 0; i--) {
    const turn = turnPairs[i]
    const turnStr = turn.assistant ? `User: ${turn.user}\nAssistant: ${turn.assistant}` : `User: ${turn.user}`
    if (recentTurns.length >= 2 && recentChars + turnStr.length > recentBudget) {
      break
    }
    recentTurns.unshift(turn)
    recentChars += turnStr.length
  }

  const olderTurns = turnPairs.slice(0, turnPairs.length - recentTurns.length)

  // Distill older turns into summary synopsis
  const summaryPoints = olderTurns.map((turn, idx) => distillTurn(turn.user, turn.assistant, idx + 1))
  const summarySection = summaryPoints.length > 0
    ? `[SINTESI CONTESTO CONVERSAZIONE PRECEDENTE (Cronologia Storica Compattata)]\n${summaryPoints.join('\n')}\n[FINE SINTESI STORICA]`
    : ''

  const recentSection = recentTurns
    .map((t) => (t.assistant ? `User: ${t.user}\nAssistant: ${t.assistant}` : `User: ${t.user}`))
    .join('\n\n')

  const combined = [summarySection, recentSection].filter(Boolean).join('\n\n')

  return {
    historyBlock: combined,
    isCompacted: true,
    summarizedTurnsCount: olderTurns.length,
    verbatimTurnsCount: recentTurns.length,
    totalOriginalChars,
    finalChars: combined.length,
  }
}
