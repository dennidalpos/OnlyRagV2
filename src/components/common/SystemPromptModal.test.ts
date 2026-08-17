import { describe, it, expect } from 'vitest'
import { detectModelFamily } from '../../constants/promptPresets'
import {
  getEffectivePrompt,
  compilePromptWithSampleVars,
  MODULE_VARIABLES,
} from './SystemPromptModal'
import { PromptCompiler } from '../../../electron/core/domain/agent/promptCompiler'
import { AppSettings } from '../../types'

describe('SystemPromptModal & Family Detection Tests', () => {
  it('should accurately detect model families from Ollama model strings', () => {
    expect(detectModelFamily('llama3.2:latest')).toBe('llama')
    expect(detectModelFamily('llama3.1:8b')).toBe('llama')
    expect(detectModelFamily('qwen2.5-coder:7b')).toBe('qwen')
    expect(detectModelFamily('deepseek-r1:8b')).toBe('deepseek')
    expect(detectModelFamily('codestral:22b')).toBe('mistral')
    expect(detectModelFamily('mixtral:8x7b')).toBe('mistral')
    expect(detectModelFamily('phi4:14b')).toBe('phi')
    expect(detectModelFamily('moondream:latest')).toBe('moondream')
    expect(detectModelFamily('minicpm-v:8b')).toBe('minicpm')
    expect(detectModelFamily('llava:13b')).toBe('llava')
    expect(detectModelFamily('bge-m3:latest')).toBe('bge')
    expect(detectModelFamily('nomic-embed-text:latest')).toBe('nomic')
    expect(detectModelFamily('mxbai-embed-large:latest')).toBe('mxbai')
    expect(detectModelFamily('yi-coder:9b')).toBe('yicoder')
    expect(detectModelFamily('starcoder2:7b')).toBe('starcoder')
    expect(detectModelFamily('')).toBe('generic')
    expect(detectModelFamily('unknown-custom-model')).toBe('generic')
  })

  it('should compute effective prompts based on module and model family', () => {
    const baseSettings: AppSettings = {
      defaultModel: 'qwen2.5-coder:7b',
      hardwareProfile: 'Auto',
      ocrEngine: 'native_cuda',
      ollamaHost: 'http://127.0.0.1:11434',
    }

    const res = getEffectivePrompt('chat', 'qwen2.5-coder:7b', baseSettings)
    expect(res.family).toBe('qwen')
    expect(res.prompt.length).toBeGreaterThan(0)
    expect(res.isCustom).toBe(false)
  })

  it('should prioritize manual selectedFamilyOverrides over auto-detection', () => {
    const overrideSettings: AppSettings = {
      defaultModel: 'qwen2.5-coder:7b',
      hardwareProfile: 'Auto',
      ocrEngine: 'native_cuda',
      ollamaHost: 'http://127.0.0.1:11434',
      selectedFamilyOverrides: {
        chat: 'llama',
      },
    }

    const res = getEffectivePrompt('chat', 'qwen2.5-coder:7b', overrideSettings)
    expect(res.family).toBe('llama')
    expect(res.prompt).toContain('Meta Llama 3')
  })

  it('should prioritize custom prompt overrides when specified in settings', () => {
    const customSettings: AppSettings = {
      defaultModel: 'llama3.2',
      hardwareProfile: 'Auto',
      ocrEngine: 'native_cuda',
      ollamaHost: 'http://127.0.0.1:11434',
      customPromptOverrides: {
        'chat:llama': 'Custom specialized llama chat prompt override',
      },
    }

    const res = getEffectivePrompt('chat', 'llama3.2', customSettings)
    expect(res.family).toBe('llama')
    expect(res.prompt).toBe('Custom specialized llama chat prompt override')
    expect(res.isCustom).toBe(true)
  })

  it('should compile prompt with variable substitution in PromptCompiler', () => {
    const compiled = PromptCompiler.compilePrompt(
      'translation',
      'llama3.1:8b',
      {
        sourceLang: 'Italiano',
        targetLang: 'Inglese',
      }
    )

    expect(compiled.family).toBe('llama')
    expect(compiled.prompt).toContain('Italiano')
    expect(compiled.prompt).toContain('Inglese')
    expect(compiled.isCustom).toBe(false)
  })

  it('should compile prompt with sample variables in compilePromptWithSampleVars', () => {
    const rawTemplate = 'Translate from {sourceLang} to {targetLang}: "{chunkText}"'
    const compiled = compilePromptWithSampleVars(rawTemplate, 'translation')

    expect(compiled).toContain('Italian')
    expect(compiled).toContain('English')
    expect(compiled).not.toContain('{sourceLang}')
    expect(compiled).not.toContain('{targetLang}')
  })

  it('should provide comprehensive variable metadata across all feature modules', () => {
    expect(MODULE_VARIABLES.coding.length).toBeGreaterThanOrEqual(3)
    expect(MODULE_VARIABLES.translation.length).toBeGreaterThanOrEqual(3)
    expect(MODULE_VARIABLES.chat.length).toBeGreaterThanOrEqual(1)
    expect(MODULE_VARIABLES.vision.length).toBeGreaterThanOrEqual(1)

    const codingReq = MODULE_VARIABLES.coding.filter((v) => v.required)
    expect(codingReq.map((v) => v.name)).toContain('{userTask}')
    expect(codingReq.map((v) => v.name)).toContain('{workspacePath}')
  })

  it('should resolve the coding prompt by complexity tier, family-agnostic (B2)', () => {
    const compiledFast = PromptCompiler.compileCodingPrompt('fast', {
      userTask: 'Create a component',
      workspacePath: 'D:/test',
      agentMode: 'AGENT',
      stepCount: '1',
      MAX_STEPS: '20',
    })
    const compiledDeep = PromptCompiler.compileCodingPrompt('deep_reasoning', {
      userTask: 'Create a component',
      workspacePath: 'D:/test',
      agentMode: 'AGENT',
      stepCount: '1',
      MAX_STEPS: '20',
    })

    expect(compiledFast.tier).toBe('fast')
    expect(compiledDeep.tier).toBe('deep_reasoning')
    // Same model, different tier -> different prompt content (verbosity scales by tier, not family).
    expect(compiledFast.prompt).not.toBe(compiledDeep.prompt)
    expect(compiledFast.prompt).toContain('Create a component')
    expect(compiledDeep.prompt).toContain('Create a component')
  })
})
