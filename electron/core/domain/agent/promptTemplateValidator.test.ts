import { describe, it, expect } from 'vitest'
import { validateNodeTemplate, hasBlockingIssues } from './promptTemplateValidator'
import { ALL_PROMPT_NODES } from './promptHierarchyRegistry'

describe('validateNodeTemplate', () => {
  it('passes every factory default', () => {
    for (const node of ALL_PROMPT_NODES) {
      const issues = validateNodeTemplate(node.id, node.defaultValue)
      expect(issues, `${node.id}: ${issues.map((i) => i.message).join(' | ')}`).toEqual([])
    }
  })

  it('rejects an empty prompt', () => {
    const issues = validateNodeTemplate('chat', '   ')
    expect(issues).toEqual([{ severity: 'error', code: 'empty', message: expect.any(String) }])
  })

  it('rejects malformed template syntax', () => {
    const issues = validateNodeTemplate('chat', 'hello {{#unclosed}}')
    expect(issues[0].code).toBe('syntax')
    expect(hasBlockingIssues(issues)).toBe(true)
  })

  it('flags a master template that dropped a required partial', () => {
    const issues = validateNodeTemplate('coding:master', 'You are an agent.\n{{> tools}}')
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'missing-partial', tokenName: 'directives', severity: 'error' })
    )
  })

  it('flags a partial referenced twice, which would double-send the block', () => {
    const issues = validateNodeTemplate('coding:master', '{{> directives}}{{> tools}}{{> tools}}')
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'duplicate-partial', tokenName: 'tools', severity: 'error' })
    )
  })

  it('accepts a variable used more than once', () => {
    const issues = validateNodeTemplate('translation', 'From {{sourceLang}} to {{targetLang}}, in {{targetLang}}.')
    expect(issues).toEqual([])
  })

  it('warns, without blocking, about a variable the module never supplies', () => {
    const issues = validateNodeTemplate('translation', 'From {{sourceLang}} to {{targetLang}}. {{nonsense}}')
    expect(issues).toEqual([
      expect.objectContaining({ code: 'unknown-variable', tokenName: 'nonsense', severity: 'warning' }),
    ])
    expect(hasBlockingIssues(issues)).toBe(false)
  })

  it('accepts the capability flags as known context variables', () => {
    const issues = validateNodeTemplate('chat', 'Base. {{#nativeVision}}You can see images.{{/nativeVision}}')
    expect(issues).toEqual([])
  })

  it('returns nothing for an unknown node id', () => {
    expect(validateNodeTemplate('does:not:exist' as never, 'anything')).toEqual([])
  })
})
