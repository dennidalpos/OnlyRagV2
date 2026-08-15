import { describe, it, expect } from 'vitest'
import { PromptCompiler } from './promptCompiler'
import { detectModelFamily, MODEL_FAMILIES } from './promptPresets'

describe('PromptCompiler & Model Family Resolution Tests', () => {
  it('should detect model families accurately from model names', () => {
    expect(detectModelFamily('qwen2.5-coder:7b')).toBe('qwen')
    expect(detectModelFamily('deepseek-r1:8b')).toBe('deepseek')
    expect(detectModelFamily('llama3.2:latest')).toBe('llama')
    expect(detectModelFamily('codestral:22b')).toBe('mistral')
    expect(detectModelFamily('mistral:7b')).toBe('mistral')
    expect(detectModelFamily('codegemma:7b')).toBe('gemma')
    expect(detectModelFamily('phi4:14b')).toBe('phi')
    expect(detectModelFamily('codellama:13b')).toBe('codellama')
    expect(detectModelFamily('command-r-plus')).toBe('commandr')
    expect(detectModelFamily('yi-coder:9b')).toBe('yicoder')
    expect(detectModelFamily('starcoder2:15b')).toBe('starcoder')
    expect(detectModelFamily('custom-unknown-model')).toBe('generic')
  })

  it('should compile specialized system prompts for each model family', () => {
    const modelsToTest = [
      { name: 'qwen2.5-coder:7b', expectedSnippet: 'Lead Software Architect' },
      { name: 'deepseek-coder:6.7b', expectedSnippet: 'DeepSeek' },
      { name: 'llama3.2:3b', expectedSnippet: 'Llama 3' },
      { name: 'codestral:22b', expectedSnippet: 'Codestral/Mistral' },
      { name: 'codegemma:7b', expectedSnippet: 'CodeGemma' },
      { name: 'phi4:14b', expectedSnippet: 'Phi-4' },
      { name: 'codellama:7b', expectedSnippet: 'CodeLlama' },
      { name: 'command-r', expectedSnippet: 'Command R+' },
      { name: 'yi-coder:9b', expectedSnippet: 'Yi-Coder' },
      { name: 'starcoder2:7b', expectedSnippet: 'StarCoder2' },
      { name: 'unknown-llm', expectedSnippet: 'expert AI Coding Agent' },
    ]

    for (const { name, expectedSnippet } of modelsToTest) {
      const { prompt, family } = PromptCompiler.compilePrompt('coding', name, {
        userTask: 'Build dashboard',
        workspacePath: 'D:/app',
        agentMode: 'AGENT',
        stepCount: '1',
        MAX_STEPS: '∞',
      })

      expect(prompt).toContain(expectedSnippet)
      expect(prompt).toContain('Build dashboard')
      expect(prompt).toContain('D:/app')
      expect(prompt).toContain('AGENT')
      expect(family).toBeDefined()
    }
  })

  it('should support custom user prompt overrides if configured in settings', () => {
    const customPrompt = 'CUSTOM OVERRIDE: {userTask} in mode {agentMode}'
    const { prompt, isCustom } = PromptCompiler.compilePrompt(
      'coding',
      'qwen2.5-coder:7b',
      { userTask: 'Test task', agentMode: 'PLAN' },
      {
        customPromptOverrides: {
          'coding:qwen': customPrompt,
        },
      } as any
    )

    expect(isCustom).toBe(true)
    expect(prompt).toBe('CUSTOM OVERRIDE: Test task in mode PLAN')
  })
})
