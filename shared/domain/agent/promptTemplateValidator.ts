import { collectTemplateTokens, TemplateSyntaxError } from './promptTemplateEngine'
import { findPromptNode, type PromptNodeId } from './promptHierarchyRegistry'

/**
 * Structural checks on a user-edited prompt template.
 *
 * Two of these guard real token costs rather than style: a partial referenced twice sends that
 * block twice on every turn (~1.000 tokens per step for the tool schema), and a master template
 * that lost `{{> directives}}` silently strips the agent's anti-loop and completion-gate rules
 * while still looking fine in the editor.
 */

export type PromptIssueSeverity = 'error' | 'warning'

export type PromptIssueCode =
  | 'syntax'
  | 'empty'
  | 'missing-partial'
  | 'duplicate-partial'
  | 'unknown-variable'

export interface PromptIssue {
  severity: PromptIssueSeverity
  code: PromptIssueCode
  /** Token the issue refers to, when it refers to one. */
  tokenName?: string
  /** English message; the UI maps `code` to a localized string and uses this as fallback. */
  message: string
}

export function validateNodeTemplate(nodeId: PromptNodeId, template: string): PromptIssue[] {
  const node = findPromptNode(nodeId)
  if (!node) return []

  if (!template.trim()) {
    return [{ severity: 'error', code: 'empty', message: 'The prompt cannot be empty.' }]
  }

  let tokens
  try {
    tokens = collectTemplateTokens(template)
  } catch (err) {
    return [
      {
        severity: 'error',
        code: 'syntax',
        message: err instanceof TemplateSyntaxError ? err.message : 'Invalid template syntax.',
      },
    ]
  }

  const issues: PromptIssue[] = []
  const partials = tokens.filter((t) => t.type === 'partial')

  for (const required of node.requiredPartials ?? []) {
    if (!partials.some((p) => p.name === required)) {
      issues.push({
        severity: 'error',
        code: 'missing-partial',
        tokenName: required,
        message: `Missing {{> ${required}}}: that block will not be sent to the model.`,
      })
    }
  }

  for (const partial of partials) {
    if (partial.occurrences > 1) {
      issues.push({
        severity: 'error',
        code: 'duplicate-partial',
        tokenName: partial.name,
        message: `{{> ${partial.name}}} appears ${partial.occurrences} times: the block would be sent ${partial.occurrences} times every turn.`,
      })
    }
  }

  // Repeated variables are legitimate — the image prompt names {{currentPage}} twice on purpose.
  // Only unknown ones are worth surfacing, and only as a warning: a variable this module never
  // supplies renders as an empty string rather than breaking anything.
  const known = new Set(node.variables.map((v) => v.name))
  const contextual = new Set(['nativeToolCalling', 'nativeVision'])
  for (const token of tokens) {
    if (token.type !== 'variable') continue
    if (known.has(token.name) || contextual.has(token.name)) continue
    issues.push({
      severity: 'warning',
      code: 'unknown-variable',
      tokenName: token.name,
      message: `{{${token.name}}} is not provided by this module and will render as empty.`,
    })
  }

  return issues
}

export function hasBlockingIssues(issues: PromptIssue[]): boolean {
  return issues.some((i) => i.severity === 'error')
}
