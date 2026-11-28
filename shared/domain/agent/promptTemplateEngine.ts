import Mustache from 'mustache'
import { errorMessage } from '../errors/errorMessage'

/** Mustache-backed rendering for system-prompt templates. */

const RENDER_CONFIG = { escape: (text: string) => text }

export type TemplateTokenType = 'variable' | 'partial' | 'section' | 'invertedSection'

export interface TemplateToken {
  type: TemplateTokenType
  name: string
  /** How many times this exact token appears in the template. Populated by collectTemplateTokens. */
  occurrences: number
}

export class TemplateSyntaxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TemplateSyntaxError'
  }
}

/** Renders a template. */
export function renderPromptTemplate(template: string, variables: Record<string, unknown> = {}, partials: Record<string, string> = {}): string {
  try {
    return Mustache.render(template, variables, partials, RENDER_CONFIG)
  } catch (err: unknown) {
    throw new TemplateSyntaxError(errorMessage(err) || 'Invalid template syntax')
  }
}

/** Flattens a template's AST into the distinct tokens it references, with occurrence counts. */
export function collectTemplateTokens(template: string): TemplateToken[] {
  let ast: unknown[]
  try {
    ast = Mustache.parse(template)
  } catch (err: unknown) {
    throw new TemplateSyntaxError(errorMessage(err) || 'Invalid template syntax')
  }

  const counts = new Map<string, TemplateToken>()

  const walk = (nodes: unknown[]): void => {
    for (const node of nodes) {
      if (!Array.isArray(node)) continue
      const [symbol, name, , , subTokens] = node as [string, string, number, number, unknown[]?]
      const type = TOKEN_TYPE_BY_SYMBOL[symbol]

      if (type) {
        const key = `${type}:${name}`
        const existing = counts.get(key)
        if (existing) existing.occurrences += 1
        else counts.set(key, { type, name, occurrences: 1 })
      }

      if (Array.isArray(subTokens)) walk(subTokens)
    }
  }

  walk(ast)
  return [...counts.values()]
}

/** Mustache token symbols we care about. 'text' and '!' (comments) are deliberately ignored. */
const TOKEN_TYPE_BY_SYMBOL: Record<string, TemplateTokenType | undefined> = {
  name: 'variable',
  '&': 'variable',
  '>': 'partial',
  '#': 'section',
  '^': 'invertedSection',
}

/** Collapses runs of 3+ newlines to a single blank line. */
export function collapseBlankRuns(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n')
}
