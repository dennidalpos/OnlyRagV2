import { describe, it, expect } from 'vitest'
import {
  PromptCompiler,
  getEffectivePrompt,
  compilePromptWithSampleVars,
  resolveNodeTemplate,
} from '../../../../shared/domain/agent/promptCompiler'
import { CODING_TOOLS_BLOCK, CODING_CORE_DIRECTIVES } from '../../../../shared/domain/agent/promptPresets'
import type { AppSettings } from '../../../../shared/types'

const baseSettings = { customPromptOverrides: {} } as AppSettings

const withOverride = (nodeId: string, value: string): AppSettings =>
  ({ customPromptOverrides: { [nodeId]: value } }) as unknown as AppSettings

const codingVars = {
  agentMode: 'AGENT',
  userTask: 'Add a health endpoint',
  workspacePath: 'D:/ws',
  currentDate: '2026-08-23',
}

describe('coding prompt assembly', () => {
  it('splices the directives and tool blocks into the master template', () => {
    const { prompt } = PromptCompiler.compileCodingPrompt(codingVars, baseSettings, false)
    expect(prompt).toContain('Add a health endpoint')
    expect(prompt).toContain('D:/ws')
    expect(prompt).toContain('EXECUTION RULES')
    expect(prompt).toContain('AVAILABLE AGENT TOOLS')
  })

  it('omits the prose tool block when the model declares the native tools capability (AGT2)', () => {
    const { prompt } = PromptCompiler.compileCodingPrompt(codingVars, baseSettings, true)
    expect(prompt).not.toContain('AVAILABLE AGENT TOOLS')
    expect(prompt).toContain('EXECUTION RULES')
  })

  it('leaves no blank-line crater where the omitted tool block was', () => {
    const { prompt } = PromptCompiler.compileCodingPrompt(codingVars, baseSettings, true)
    expect(prompt).not.toMatch(/\n{3,}/)
    expect(prompt.endsWith('\n')).toBe(false)
  })

  it('substitutes {{workspacePath}} inside the directives child node too', () => {
    const { prompt } = PromptCompiler.compileCodingPrompt(codingVars, baseSettings, false)
    expect(prompt).not.toContain('{{workspacePath}}')
    expect(prompt.match(/D:\/ws/g)?.length).toBeGreaterThan(1)
  })

  it('is identical whatever the model is called — no family branching remains', () => {
    const a = PromptCompiler.compileCodingPrompt(codingVars, baseSettings, false).prompt
    const b = PromptCompiler.compileCodingPrompt(codingVars, baseSettings, false).prompt
    expect(a).toBe(b)
    expect(a).not.toContain('Qwen')
    expect(a).not.toContain('Llama')
  })
})

describe('node overrides', () => {
  it('uses the override for a single node and leaves its siblings on defaults', () => {
    const settings = withOverride('coding:directives', 'ONLY RULE: ship it.')
    const { prompt, isCustom } = PromptCompiler.compileCodingPrompt(codingVars, settings, false)
    expect(isCustom).toBe(true)
    expect(prompt).toContain('ONLY RULE: ship it.')
    expect(prompt).not.toContain('EXECUTION RULES')
    expect(prompt).toContain('AVAILABLE AGENT TOOLS')
  })

  it('still honours the capability gate when the tool node is overridden', () => {
    const settings = withOverride('coding:tools', 'MY OWN TOOL LIST')
    expect(PromptCompiler.compileCodingPrompt(codingVars, settings, false).prompt).toContain('MY OWN TOOL LIST')
    expect(PromptCompiler.compileCodingPrompt(codingVars, settings, true).prompt).not.toContain('MY OWN TOOL LIST')
  })

  it('treats a whitespace-only override as absent', () => {
    const settings = withOverride('chat', '   \n  ')
    expect(getEffectivePrompt('chat', settings).isCustom).toBe(false)
  })

  it('reports isCustom=false when nothing is overridden', () => {
    expect(getEffectivePrompt('chat', baseSettings).isCustom).toBe(false)
    expect(resolveNodeTemplate('chat', baseSettings).isCustom).toBe(false)
  })
})

describe('getEffectivePrompt', () => {
  it('substitutes the translation languages instead of shipping raw placeholders', () => {
    const { prompt } = getEffectivePrompt('translation', baseSettings, {
      variables: { sourceLang: 'Italian', targetLang: 'English' },
    })
    expect(prompt).toContain('from Italian to English')
    expect(prompt).not.toContain('{{sourceLang}}')
    expect(prompt).not.toContain('{{targetLang}}')
  })

  it('resolves the chat prompt without needing a model name', () => {
    const { prompt } = getEffectivePrompt('chat', baseSettings)
    expect(prompt).toContain('[INDEXED DOCUMENT CONTEXT (LanceDB)]')
  })

  it('resolves the image analysis prompt', () => {
    const { prompt } = getEffectivePrompt('images', baseSettings, {
      variables: { filename: 'report.pdf', currentPage: '2', numPages: '9', activePageContent: 'X' },
    })
    expect(prompt).toContain('report.pdf')
    expect(prompt).toContain('Viewing Page 2 of 9')
  })
})

describe('compilePromptWithSampleVars', () => {
  it('fills placeholders from the registry samples for the preview pane', () => {
    const compiled = compilePromptWithSampleVars('From {{sourceLang}} to {{targetLang}}.', 'translation')
    expect(compiled).toBe('From [Source language, e.g. Italian] to [Target language, e.g. English].')

    const withContext = compilePromptWithSampleVars('From {{sourceLang}} to {{targetLang}}.', 'translation', undefined, {
      sourceLang: 'Italian',
      targetLang: 'English',
    })
    expect(withContext).toBe('From Italian to English.')
  })

  it('expands partials so the preview shows the whole assembled prompt', () => {
    const compiled = compilePromptWithSampleVars('{{> tools}}', 'coding:master')
    expect(compiled).toContain('AVAILABLE AGENT TOOLS')
  })

  it('compiles preview for all 6 prompt nodes without errors', () => {
    // 1. coding:master
    const codingMaster = compilePromptWithSampleVars(PromptCompiler.getDefaultTemplate('coding:master'), 'coding:master')
    expect(codingMaster).toContain('AGENT')
    expect(codingMaster).toContain('EXECUTION RULES')
    expect(codingMaster).toContain('AVAILABLE AGENT TOOLS')

    // 2. coding:directives
    const codingDirectives = compilePromptWithSampleVars(PromptCompiler.getDefaultTemplate('coding:directives'), 'coding:directives')
    expect(codingDirectives).toContain('LANGUAGE:')
    expect(codingDirectives).toContain('[workspace path]')

    // 3. coding:tools
    const codingTools = compilePromptWithSampleVars(PromptCompiler.getDefaultTemplate('coding:tools'), 'coding:tools')
    expect(codingTools).toContain('AVAILABLE AGENT TOOLS')

    // 4. chat
    const chatPrompt = compilePromptWithSampleVars(PromptCompiler.getDefaultTemplate('chat'), 'chat')
    expect(chatPrompt).toContain('RAG (Retrieval-Augmented Generation)')

    // 5. translation
    const translationPrompt = compilePromptWithSampleVars(PromptCompiler.getDefaultTemplate('translation'), 'translation')
    expect(translationPrompt).toContain('[Source language, e.g. Italian]')
    expect(translationPrompt).toContain('[Target language, e.g. English]')

    // 6. images:analysis
    const imagePrompt = compilePromptWithSampleVars(PromptCompiler.getDefaultTemplate('images:analysis'), 'images:analysis')
    expect(imagePrompt).toContain('[Document filename, e.g. report.pdf]')
    expect(imagePrompt).toContain('Viewing Page 1 of 10')
  })

  it('returns the raw text for a half-typed template instead of blanking the pane', () => {
    expect(compilePromptWithSampleVars('{{#unclosed}}', 'chat')).toBe('{{#unclosed}}')
  })
})

describe('factory defaults', () => {
  it('exposes each node default verbatim', () => {
    expect(PromptCompiler.getDefaultTemplate('coding:tools')).toBe(CODING_TOOLS_BLOCK)
    expect(PromptCompiler.getDefaultTemplate('coding:directives')).toBe(CODING_CORE_DIRECTIVES)
  })
})
