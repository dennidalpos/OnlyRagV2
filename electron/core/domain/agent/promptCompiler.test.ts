import { describe, it, expect } from 'vitest'
import { PromptCompiler } from './promptCompiler'
import { detectModelFamily } from './promptPresets'

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
    expect(detectModelFamily('glm4:9b')).toBe('glm')
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
    expect(detectModelFamily('custom-unknown-model')).toBe('generic')
  })

  it('should compile the SAME family-agnostic coding prompt regardless of model name/family (B2)', () => {
    const modelsToTest = ['qwen2.5-coder:7b', 'deepseek-coder:6.7b', 'llama3.2:3b', 'codestral:22b', 'unknown-llm']

    const prompts = modelsToTest.map((_name) =>
      PromptCompiler.compileCodingPrompt({
        userTask: 'Build dashboard',
        workspacePath: 'D:/app',
        agentMode: 'AGENT',
        stepCount: '1',
        MAX_STEPS: '∞',
      }).prompt
    )

    // Every model resolves to the identical template — no per-family, no per-tier branching.
    expect(new Set(prompts).size).toBe(1)
    expect(prompts[0]).toContain('Build dashboard')
    expect(prompts[0]).toContain('D:/app')
    expect(prompts[0]).toContain('AGENT')
  })

  it('should compile the unified coding prompt with core directives and anti-stub rules', () => {
    const vars = { userTask: 'Task', workspacePath: 'D:/app', agentMode: 'AGENT', stepCount: '1', MAX_STEPS: '50' }
    const compiled = PromptCompiler.compileCodingPrompt(vars).prompt

    expect(compiled).toContain('Task')
    expect(compiled).toContain('D:/app')
    expect(compiled).toContain('AGENT')
    expect(compiled).toContain('COMPLETE CODE')
  })

  it('should support a custom user prompt override under the single "coding" key', () => {
    const customPrompt = 'CUSTOM OVERRIDE: {userTask} in mode {agentMode}'
    const { prompt, isCustom } = PromptCompiler.compileCodingPrompt(
      { userTask: 'Test task', agentMode: 'PLAN' },
      {
        customPromptOverrides: {
          coding: customPrompt,
        },
      } as any
    )

    expect(isCustom).toBe(true)
    expect(prompt).toBe('CUSTOM OVERRIDE: Test task in mode PLAN')

    // Direct 'coding' key
    const directCoding = PromptCompiler.compileCodingPrompt(
      { userTask: 'Build feature', agentMode: 'AGENT' },
      {
        customPromptOverrides: {
          coding: 'DIRECT CODING: {userTask}',
        },
      } as any
    )
    expect(directCoding.isCustom).toBe(true)
    expect(directCoding.prompt).toBe('DIRECT CODING: Build feature')

    // Direct 'chat' key
    const directChat = PromptCompiler.compilePrompt(
      'chat',
      'llama3.2',
      {},
      {
        customPromptOverrides: {
          chat: 'DIRECT CHAT PROMPT',
        },
      } as any
    )
    expect(directChat.isCustom).toBe(true)
    expect(directChat.prompt).toBe('DIRECT CHAT PROMPT')
  })

  it('should still resolve family-based prompts (chat) unaffected by the coding tier change', () => {
    const { prompt, family } = PromptCompiler.compilePrompt('chat', 'qwen2.5-coder:7b', {})
    expect(family).toBe('qwen')
    expect(prompt).toContain('Qwen 2.5')
  })

  it('should include the prose AVAILABLE AGENT TOOLS block by default (prompt-engineered path)', () => {
    const vars = { userTask: 'Task', workspacePath: 'D:/app', agentMode: 'AGENT', stepCount: '1', MAX_STEPS: '50' }
    const prompt = PromptCompiler.compileCodingPrompt(vars).prompt
    expect(prompt).toContain('AVAILABLE AGENT TOOLS')
    expect(prompt).toContain('extract_code_symbols')
  })

  it('should omit the prose AVAILABLE AGENT TOOLS block when toolCallingCapable=true (AGT2: avoid double-sending the tool schema)', () => {
    const vars = { userTask: 'Task', workspacePath: 'D:/app', agentMode: 'AGENT', stepCount: '1', MAX_STEPS: '50' }
    const prompt = PromptCompiler.compileCodingPrompt(vars, undefined, true).prompt
    expect(prompt).not.toContain('AVAILABLE AGENT TOOLS')
    expect(prompt).not.toContain('extract_code_symbols')
    expect(prompt).toContain('Task')
  })
})
