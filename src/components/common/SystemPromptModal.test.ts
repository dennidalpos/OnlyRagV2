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
    expect(detectModelFamily('granite3.3:2b')).toBe('granite')
    expect(detectModelFamily('hermes-3:8b')).toBe('hermes')
    expect(detectModelFamily('nemotron:latest')).toBe('nemotron')
    expect(detectModelFamily('smollm2:1.7b')).toBe('smollm')
    expect(detectModelFamily('solar:10.7b')).toBe('solar')
    expect(detectModelFamily('internlm2.5:7b')).toBe('internlm')
    expect(detectModelFamily('falcon3:7b')).toBe('falcon')
    expect(detectModelFamily('exaone3.5:7.8b')).toBe('exaone')
    expect(detectModelFamily('all-minilm:latest')).toBe('minilm')
    expect(detectModelFamily('snowflake-arctic-embed:latest')).toBe('arctic')
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

  it('should support direct module-level custom prompt overrides for all modules', () => {
    const directSettings: AppSettings = {
      defaultModel: 'qwen2.5-coder:7b',
      hardwareProfile: 'Auto',
      ocrEngine: 'native_cuda',
      ollamaHost: 'http://127.0.0.1:11434',
      customPromptOverrides: {
        chat: 'My customized chat prompt',
        coding: 'My customized coding prompt',
        translation: 'My customized translation prompt',
      },
    }

    const chatRes = getEffectivePrompt('chat', 'qwen2.5-coder:7b', directSettings)
    expect(chatRes.prompt).toBe('My customized chat prompt')
    expect(chatRes.isCustom).toBe(true)

    const codingRes = getEffectivePrompt('coding', 'qwen2.5-coder:7b', directSettings)
    expect(codingRes.prompt).toBe('My customized coding prompt')
    expect(codingRes.isCustom).toBe(true)

    const transRes = getEffectivePrompt('translation', 'qwen2.5-coder:7b', directSettings)
    expect(transRes.prompt).toBe('My customized translation prompt')
    expect(transRes.isCustom).toBe(true)
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

  it('should resolve the unified coding prompt, family-agnostic (B2)', () => {
    const compiled = PromptCompiler.compileCodingPrompt({
      userTask: 'Create a component',
      workspacePath: 'D:/test',
      agentMode: 'AGENT',
      stepCount: '1',
      MAX_STEPS: '20',
    })

    expect(compiled.prompt).toContain('Create a component')
    expect(compiled.prompt).toContain('D:/test')
    expect(compiled.prompt).toContain('AGENT')
    expect(compiled.prompt).toContain('COMPLETE CODE')
  })

  it('grounds the chat preset in the injected context and leaves the absent-document case to the turn assembler', () => {
    const baseSettings: AppSettings = {
      defaultModel: 'llama3.2',
      hardwareProfile: 'Auto',
      ocrEngine: 'native_cuda',
      ollamaHost: 'http://127.0.0.1:11434',
    }

    const res = getEffectivePrompt('chat', 'llama3.2', baseSettings)
    expect(res.prompt).toContain('INDEXED DOCUMENT CONTEXT')

    // This test used to require the opposite: that the preset also script the "nothing is
    // attached" reply. It does not any more, and must not. The preset is static, so that script
    // reached the model with a document attached too, and llama3.2:3b then produced it verbatim
    // for 3 of 5 questions while retrieval was returning excerpts of that same document. The
    // absent-document directive now lives only in useChatEngine's per-turn block.
    expect(res.prompt).not.toContain('ATTACHMENT CONTEXT STATUS')
    expect(res.prompt).not.toMatch(/select a document from the (left )?sidebar/i)
  })
})
