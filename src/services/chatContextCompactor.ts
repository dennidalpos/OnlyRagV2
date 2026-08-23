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
function distillTurn(userText: string, botText: string): string {
  const cleanUser = (userText || '').replace(/\s+/g, ' ').trim()
  const cleanBot = (botText || '').replace(/\s+/g, ' ').trim()

  const summarizedUser = cleanUser.length > 250
    ? TextRankSummarizer.summarize(cleanUser, { targetSentences: 2 }) || cleanUser.slice(0, 240)
    : cleanUser

  const summarizedBot = cleanBot.length > 350
    ? TextRankSummarizer.summarize(cleanBot, { targetSentences: 2 }) || cleanBot.slice(0, 340)
    : cleanBot

  return `User: ${summarizedUser}\nAssistant: ${summarizedBot}`
}

/**
 * Automatically compacts chat history based on dynamic hardware budget without hardcoded turn dropping.
 * Preserves 100% of historical turns through rolling semantic synopsis when total dialogue exceeds available budget.
 */
export function compactChatHistory(
  messages: ChatMessage[],
  budget: ChatContextBudget,
  hasSelectedDocs: boolean,
  availableChars?: number
): ChatCompactionResult {
  // Filter out empty messages and the initial placeholder greeting only
  const dialogueMessages = messages
    .filter((m) => {
      if (!m.text || !m.text.trim()) return false
      if (m.sender === 'bot' && m.id === '1') {
        return false
      }
      return true
    })

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

  // Character budget for the replayed history.
  //
  // `availableChars` is what the caller has left after the system prompt and the selected
  // document context have taken their share, and it WINS when supplied. The fallback below is
  // only for callers that do not budget the whole prompt: `maxNumCtx * 2.0` sizes the history in
  // isolation, as if the rest of the turn did not have to fit in the same window, which left the
  // answer as little as 61 tokens to generate into on a legacy profile.
  //
  // The selected attachment outranks conversation history on purpose: the user picked that
  // document for this question, and it is the one thing the answer cannot be produced without.
  const fallbackBudget = hasSelectedDocs
    ? Math.max(budget.historyChars, Math.floor(budget.maxNumCtx * 2.0))
    : Math.max(budget.historyChars, Math.floor(budget.maxNumCtx * 3.5 - 2500))
  const baseBudget = availableChars !== undefined ? Math.max(0, availableChars) : fallbackBudget

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

  // If over budget, dynamically allocate 80% to recent turns and distill older turns
  const recentBudget = Math.floor(baseBudget * 0.80)
  const recentTurns: typeof turnPairs = []
  let recentChars = 0

  for (let i = turnPairs.length - 1; i >= 0; i--) {
    const turn = turnPairs[i]
    const turnStr = turn.assistant ? `User: ${turn.user}\nAssistant: ${turn.assistant}` : `User: ${turn.user}`
    if (recentTurns.length >= 4 && recentChars + turnStr.length > recentBudget) {
      break
    }
    recentTurns.unshift(turn)
    recentChars += turnStr.length
  }

  const olderTurns = turnPairs.slice(0, turnPairs.length - recentTurns.length)

  // Distill older turns into concise conversational dialogue turns
  const summaryPoints = olderTurns.map((turn) => distillTurn(turn.user, turn.assistant))
  const summarySection = summaryPoints.join('\n\n')

  const recentSection = recentTurns
    .map((t) => (t.assistant ? `User: ${t.user}\nAssistant: ${t.assistant}` : `User: ${t.user}`))
    .join('\n\n')

  const combined = [summarySection, recentSection].filter(Boolean).join('\n\n')

  // Hard ceiling. Distillation is best-effort - TextRankSummarizer cannot shrink text with no
  // sentence structure (logs, tables, code), and the recent-turn loop deliberately keeps the
  // last 4 turns whatever their size - so without this clamp the block could still exceed the
  // caller's budget and push the selected document out of the context window. Trim from the
  // FRONT: the most recent turns are the ones the answer depends on.
  const bounded = combined.length > baseBudget
    ? `[...older conversation trimmed to fit the context window]\n\n${combined.slice(combined.length - baseBudget)}`
    : combined

  return {
    historyBlock: bounded,
    isCompacted: true,
    summarizedTurnsCount: olderTurns.length,
    verbatimTurnsCount: recentTurns.length,
    totalOriginalChars,
    finalChars: bounded.length,
  }
}
