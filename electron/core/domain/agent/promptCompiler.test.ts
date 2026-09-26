import { describe, it, expect } from 'vitest'
import { PromptCompiler, getEffectivePrompt, compilePromptWithSampleVars, resolveNodeTemplate } from '../../../../shared/domain/agent/promptCompiler'
import { CODING_CORE_DIRECTIVES } from '../../../../shared/domain/agent/promptPresets'
import type { AppSettings } from '../../../../shared/types'

const baseSettings = { customPromptOverrides: {} } as AppSettings

const withOverride = (nodeId: string, value: string): AppSettings => ({ customPromptOverrides: { [nodeId]: value } }) as unknown as AppSettings

const codingVars = {
  agentMode: 'AGENT',
  userTask: 'Add a health endpoint',
  workspacePath: 'D:/ws',
  currentDate: '2026-08-23',
}

describe('coding prompt assembly', () => {
  it('splices the directives into the master template, with no prose tool catalogue', () => {
    const { prompt } = PromptCompiler.compileCodingPrompt(codingVars, baseSettings)
    expect(prompt).toContain('D:/ws')
    expect(prompt).toContain('EXECUTION RULES')
    expect(prompt).not.toContain('AVAILABLE AGENT TOOLS')
  })

  it('leaves no trailing blank lines', () => {
    const { prompt } = PromptCompiler.compileCodingPrompt(codingVars, baseSettings)
    expect(prompt).not.toMatch(/\n{3,}/)
    expect(prompt.endsWith('\n')).toBe(false)
  })

  it('substitutes {{workspacePath}} inside the directives child node too', () => {
    const { prompt } = PromptCompiler.compileCodingPrompt(codingVars, baseSettings)
    expect(prompt).not.toContain('{{workspacePath}}')
    expect(prompt.match(/D:\/ws/g)?.length).toBeGreaterThan(1)
  })

  it('is identical whatever the model is called — no family branching remains', () => {
    const a = PromptCompiler.compileCodingPrompt(codingVars, baseSettings).prompt
    const b = PromptCompiler.compileCodingPrompt(codingVars, baseSettings).prompt
    expect(a).toBe(b)
    expect(a).not.toContain('Qwen')
    expect(a).not.toContain('Llama')
  })
})

describe('node overrides', () => {
  it('uses the override for a single node and leaves its siblings on defaults', () => {
    const settings = withOverride('coding:directives', 'ONLY RULE: ship it.')
    const { prompt, isCustom } = PromptCompiler.compileCodingPrompt(codingVars, settings)
    expect(isCustom).toBe(true)
    expect(prompt).toContain('ONLY RULE: ship it.')
    expect(prompt).not.toContain('EXECUTION RULES')
  })

  it('renders the native variant of a custom master written for the retired text protocol', () => {
    const legacyMaster =
      '{{^nativeToolCalling}}USER INSTRUCTION: "{{userTask}}"\n{{/nativeToolCalling}}ROOT {{workspacePath}}\n{{> directives}}\n{{^nativeToolCalling}}{{> tools}}{{/nativeToolCalling}}'
    const { prompt } = PromptCompiler.compileCodingPrompt(codingVars, withOverride('coding:master', legacyMaster))
    expect(prompt).toContain('ROOT D:/ws')
    expect(prompt).not.toContain('USER INSTRUCTION')
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
    const compiled = compilePromptWithSampleVars('{{> directives}}', 'coding:master')
    expect(compiled).toContain('EXECUTION RULES')
  })

  it('compiles preview for all 5 prompt nodes without errors', () => {
    // 1. coding:master
    const codingMaster = compilePromptWithSampleVars(PromptCompiler.getDefaultTemplate('coding:master'), 'coding:master')
    expect(codingMaster).toContain('Operating in GUIDED mode')
    expect(codingMaster).toContain('EXECUTION RULES')
    expect(codingMaster).not.toContain('AVAILABLE AGENT TOOLS')

    // 2. coding:directives
    const codingDirectives = compilePromptWithSampleVars(PromptCompiler.getDefaultTemplate('coding:directives'), 'coding:directives')
    expect(codingDirectives).toContain('LANGUAGE:')
    expect(codingDirectives).toContain('[workspace path]')

    // 3. chat
    const chatPrompt = compilePromptWithSampleVars(PromptCompiler.getDefaultTemplate('chat'), 'chat')
    expect(chatPrompt).toContain('RAG (Retrieval-Augmented Generation)')

    // 4. translation
    const translationPrompt = compilePromptWithSampleVars(PromptCompiler.getDefaultTemplate('translation'), 'translation')
    expect(translationPrompt).toContain('[Source language, e.g. Italian]')
    expect(translationPrompt).toContain('[Target language, e.g. English]')

    // 5. images:analysis
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
    expect(PromptCompiler.getDefaultTemplate('coding:directives')).toBe(CODING_CORE_DIRECTIVES)
  })
})

describe('coding rules follow the capability policy', () => {
  const base = {
    defaultModel: '',
    ocrEngine: 'native_cuda',
    capabilityPolicyMode: 'network-approved',
    ollamaHost: 'http://localhost:11434',
  } as const satisfies AppSettings

  it('does not order web research or browser previews the policy would refuse', () => {
    const offline = PromptCompiler.compileCodingPrompt({ workspacePath: 'D:/p' }, { ...base, capabilityPolicyMode: 'offline-strict' }).prompt
    expect(offline).not.toContain('web_search')
    expect(offline).not.toContain('open_in_browser')
    expect(offline).toContain('Never start a non-exiting dev server')

    const approved = PromptCompiler.compileCodingPrompt({ workspacePath: 'D:/p' }, { ...base, capabilityPolicyMode: 'network-approved' }).prompt
    expect(approved).toContain('web_search')
    expect(approved).toContain('open_in_browser')
  })

  it('sends the task only as a user message', () => {
    expect(PromptCompiler.compileCodingPrompt({ userTask: 'Build a todo app' }, base).prompt).not.toContain('Build a todo app')
  })
})
