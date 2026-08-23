import Mustache from 'mustache'

/**
 * Mustache-backed rendering for system-prompt templates.
 *
 * Mustache was picked over Eta/EJS/Handlebars because prompt templates are user-editable and
 * persisted in settings: a template engine that compiles to `new Function` would turn the prompt
 * editor into a code-execution surface, and would need `unsafe-eval` in a renderer that runs with
 * `contextIsolation: true` / `nodeIntegration: false`. Mustache is logic-less, so the worst a
 * malformed template can do is render badly.
 *
 * Escaping is disabled per call rather than by mutating the global `Mustache.escape`: the default
 * HTML-escapes `{{var}}`, which would corrupt every prompt containing quotes, `&`, or angle
 * brackets — and the tool schema block is full of them.
 */

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

/**
 * Renders a template. `partials` maps a partial name to its template text, which is how the
 * hierarchy's child nodes ({{> directives}}, {{> tools}}) are spliced into their parent.
 *
 * A partial resolving to '' is legitimate — that is exactly how the tool schema block is dropped
 * for models that declare the native `tools` capability (AGT2).
 */
export function renderPromptTemplate(
  template: string,
  variables: Record<string, unknown> = {},
  partials: Record<string, string> = {}
): string {
  try {
    return Mustache.render(template, variables, partials, RENDER_CONFIG)
  } catch (err: any) {
    throw new TemplateSyntaxError(err?.message || 'Invalid template syntax')
  }
}

/**
 * Flattens a template's AST into the distinct tokens it references, with occurrence counts.
 *
 * Counts matter: a template that names the same partial twice sends that block twice on every
 * single turn. For {{> tools}} that is ~1.000 wasted tokens per step, which is why the validator
 * treats a repeated partial as an error rather than a style issue.
 */
export function collectTemplateTokens(template: string): TemplateToken[] {
  let ast: unknown[]
  try {
    ast = Mustache.parse(template)
  } catch (err: any) {
    throw new TemplateSyntaxError(err?.message || 'Invalid template syntax')
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

/**
 * Collapses runs of 3+ newlines to a single blank line.
 *
 * Sections and partials that resolve to '' (most often the tool schema block on native
 * tool-calling models) otherwise leave gaping holes in the prompt — pure wasted context on a
 * small window.
 */
export function collapseBlankRuns(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n')
}
