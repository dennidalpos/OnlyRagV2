import { describe, it, expect } from 'vitest'
import {
  renderPromptTemplate,
  collectTemplateTokens,
  collapseBlankRuns,
  TemplateSyntaxError,
} from '../../../../shared/domain/agent/promptTemplateEngine'

describe('renderPromptTemplate', () => {
  it('substitutes variables without HTML-escaping them', () => {
    const out = renderPromptTemplate('Task: "{{userTask}}"', { userTask: 'fix <div> & "quotes"' })
    expect(out).toBe('Task: "fix <div> & "quotes""')
  })

  it('splices partials into the parent template', () => {
    const out = renderPromptTemplate('A {{> directives}} B', {}, { directives: 'RULE 1' })
    expect(out).toBe('A RULE 1 B')
  })

  // Mustache's standalone-tag rule: a partial alone on a line consumes that line. Worth pinning
  // down, because it is what makes an omitted block disappear cleanly instead of leaving a blank
  // line behind — the tool schema block relies on it.
  it('leaves no blank line when a standalone partial resolves to empty', () => {
    const template = 'HEAD\n{{> tools}}\nTAIL'
    expect(renderPromptTemplate(template, {}, { tools: '' })).toBe('HEAD\nTAIL')
    expect(renderPromptTemplate(template, {}, { tools: 'SCHEMA' })).toBe('HEAD\nSCHEMATAIL')
  })

  it('drops an inverted section when the flag is true (AGT2 tool-block omission)', () => {
    const template = '{{^nativeTools}}{{> tools}}{{/nativeTools}}'
    const partials = { tools: 'TOOL SCHEMA' }
    expect(renderPromptTemplate(template, { nativeTools: true }, partials)).toBe('')
    expect(renderPromptTemplate(template, { nativeTools: false }, partials)).toBe('TOOL SCHEMA')
  })

  it('renders a missing variable as an empty string rather than throwing', () => {
    expect(renderPromptTemplate('[{{absent}}]', {})).toBe('[]')
  })

  it('wraps malformed template syntax in TemplateSyntaxError', () => {
    expect(() => renderPromptTemplate('{{#unclosed}}oops', {})).toThrow(TemplateSyntaxError)
  })
})

describe('collectTemplateTokens', () => {
  it('reports variables, partials and inverted sections', () => {
    const tokens = collectTemplateTokens('{{a}} {{> p}} {{^flag}}x{{/flag}} {{#on}}y{{/on}}')
    expect(tokens).toEqual(
      expect.arrayContaining([
        { type: 'variable', name: 'a', occurrences: 1 },
        { type: 'partial', name: 'p', occurrences: 1 },
        { type: 'invertedSection', name: 'flag', occurrences: 1 },
        { type: 'section', name: 'on', occurrences: 1 },
      ])
    )
  })

  it('counts repeated tokens so duplicate blocks can be rejected', () => {
    const tokens = collectTemplateTokens('{{> tools}} middle {{> tools}}')
    expect(tokens).toEqual([{ type: 'partial', name: 'tools', occurrences: 2 }])
  })

  it('descends into nested sections', () => {
    const tokens = collectTemplateTokens('{{^nativeTools}}{{> tools}}{{/nativeTools}}')
    expect(tokens.map((t) => t.name).sort()).toEqual(['nativeTools', 'tools'])
  })

  it('ignores plain text and comments', () => {
    expect(collectTemplateTokens('just text {{! a comment }}')).toEqual([])
  })

  it('wraps malformed template syntax in TemplateSyntaxError', () => {
    expect(() => collectTemplateTokens('{{#unclosed}}')).toThrow(TemplateSyntaxError)
  })
})

describe('collapseBlankRuns', () => {
  it('collapses 3+ newlines left behind by an empty partial', () => {
    expect(collapseBlankRuns('A\n\n\n\nB')).toBe('A\n\nB')
  })

  it('leaves a single blank line untouched', () => {
    expect(collapseBlankRuns('A\n\nB')).toBe('A\n\nB')
  })
})
