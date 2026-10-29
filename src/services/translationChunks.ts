import { countPromptTokens } from '../../shared/domain/agent/contextWindowCalculator'
import { IPC_TEXT_MAX_LENGTH } from '../../shared/ipc/textLimits'

export class TranslationChunkError extends Error {
  constructor(readonly reason: 'budget' | 'fence') {
    super(reason)
  }
}

/** Lossless chunks: only prose may be cut; fenced blocks are indivisible. */
export function splitMarkdownForTranslation(markdown: string, maxChunkLength = 3500, fits = (text: string) => text.length <= maxChunkLength): string[] {
  if (!markdown.trim()) return []
  if (!Number.isSafeInteger(maxChunkLength) || maxChunkLength < 2) throw new TranslationChunkError('budget')
  const chunks: string[] = []
  let current = ''
  const flush = () => {
    if (current) chunks.push(current)
    current = ''
  }
  const append = (text: string, atomic = false) => {
    if (current && (current.length + text.length > maxChunkLength || !fits(current + text))) flush()
    if (atomic) {
      if (!fits(text)) throw new TranslationChunkError('budget')
      current += text
      return
    }
    while (text) {
      let low = 0
      let high = Math.min(text.length, maxChunkLength - current.length)
      // Fit the complete prompt, including custom instructions, against the context budget.
      while (low < high) {
        const mid = Math.ceil((low + high) / 2)
        if (fits(current + text.slice(0, mid))) low = mid
        else high = mid - 1
      }
      // Never cut a UTF-16 surrogate pair.
      if (low < text.length && /[\uD800-\uDBFF]/.test(text[low - 1] || '')) low--
      if (!low) {
        if (current) {
          flush()
          continue
        }
        throw new TranslationChunkError('budget')
      }
      // Prefer a word/line boundary without discarding its whitespace.
      if (low < text.length) {
        const boundary = text.slice(0, low).search(/\s+\S*$/u)
        if (boundary > low / 2) low = boundary + 1
      }
      current += text.slice(0, low)
      text = text.slice(low)
      if (text) flush()
    }
  }

  let prose = ''
  let code = ''
  let fence: { char: string; length: number } | null = null
  for (const line of markdown.match(/[^\n]*(?:\n|$)/g) || []) {
    if (!line) continue
    if (fence) {
      code += line
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?\n?$/.exec(line)
      if (closing && closing[1][0] === fence.char && closing[1].length >= fence.length) {
        append(code, true)
        code = ''
        fence = null
      }
      continue
    }
    const opening = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)/.exec(line)
    if (opening && (opening[1][0] !== '`' || !opening[2].includes('`'))) {
      append(prose)
      prose = ''
      fence = { char: opening[1][0], length: opening[1].length }
      code = line
    } else {
      if (/^(?:#{1,2}[ \t]+Page[ \t]+\d+\b|--- Page \d+ ---)/i.test(line)) {
        append(prose)
        prose = ''
        flush()
      }
      prose += line
      if (!line.trim()) {
        append(prose)
        prose = ''
      }
    }
  }
  if (fence) throw new TranslationChunkError('fence')
  append(prose)
  flush()
  return chunks
}

export function prepareTranslationPrompts(markdown: string, instruction: string, numCtx: number): { prompts: string[]; numPredict: number } {
  if (!Number.isSafeInteger(numCtx) || numCtx < 2) throw new TranslationChunkError('budget')
  const prefix = `${instruction}\n\n[DOCUMENT CONTENT TO TRANSLATE]:\n`
  const numPredict = Math.floor(numCtx / 2)
  const inputBudget = numCtx - numPredict - Math.max(256, Math.ceil(numCtx * 0.02))
  const fits = (text: string) => prefix.length + text.length <= IPC_TEXT_MAX_LENGTH && countPromptTokens(prefix + text) <= inputBudget
  if (!fits('')) throw new TranslationChunkError('budget')
  const chunks = splitMarkdownForTranslation(markdown, Math.min(3500, IPC_TEXT_MAX_LENGTH - prefix.length), fits)
  const prompts = chunks.map((chunk) => prefix + chunk)
  // Recheck the exact payloads: token counts need not be monotonic across word boundaries.
  if (prompts.some((prompt) => prompt.length > IPC_TEXT_MAX_LENGTH || countPromptTokens(prompt) > inputBudget)) throw new TranslationChunkError('budget')
  return { prompts, numPredict }
}
