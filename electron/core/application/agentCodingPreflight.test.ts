import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { evaluateAgentCodingPreflight } from './agentCodingPreflight'

const tools = { git: true, node: true, npm: true, python: true, ollama: true }

function runPreflight(workspacePath: string, overrides: Partial<Parameters<typeof evaluateAgentCodingPreflight>[0]> = {}) {
  return evaluateAgentCodingPreflight({
    codingModel: 'qwen2.5-coder:7b',
    availableModels: ['qwen2.5-coder:7b'],
    modelMetrics: { 'qwen2.5-coder:7b': { capabilities: ['completion', 'tools'], contextLength: 32768 } },
    effectiveContextTokens: 16384,
    ollamaReachable: true,
    workspacePath,
    isStandaloneMode: false,
    toolchain: tools,
    ...overrides,
  })
}

describe('Agent Coding preflight', () => {
  it('accepts a runtime-compatible model while retaining unqualified full-task status', () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-preflight-'))
    try {
      const result = runPreflight(workspacePath)
      expect(result).toMatchObject({ ready: true })
      expect(result.checks.find((check) => check.id === 'qualification')).toMatchObject({ passed: false, blocking: false })
      expect(result.checks.find((check) => check.id === 'probes')?.detail).toContain('does not finish the plan')
      expect(result.checks.find((check) => check.id === 'memory')).toMatchObject({
        passed: false,
        blocking: false,
        detail: expect.stringContaining('16384 tokens; unknown'),
      })
    } finally {
      fs.rmSync(workspacePath, { recursive: true, force: true })
    }
  })

  it('says that no model is configured instead of naming a guessed one', () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-preflight-'))
    try {
      const model = runPreflight(workspacePath, { codingModel: '' }).checks.find((check) => check.id === 'model')
      expect(model).toMatchObject({ passed: false, blocking: true, detail: expect.stringMatching(/No coding model is configured/) })
    } finally {
      fs.rmSync(workspacePath, { recursive: true, force: true })
    }
  })

  it('blocks an unreachable runtime, an absent model, and insufficient context', () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-preflight-'))
    try {
      const result = runPreflight(workspacePath, {
        ollamaReachable: false,
        availableModels: [],
        modelMetrics: { 'qwen2.5-coder:7b': { capabilities: ['completion'], contextLength: 2048 } },
      })
      expect(result.ready).toBe(false)
      expect(result.checks.filter((check) => check.blocking && !check.passed).map((check) => check.id)).toEqual(['ollama', 'model', 'tools', 'context'])
    } finally {
      fs.rmSync(workspacePath, { recursive: true, force: true })
    }
  })

  it.each([2048, 65536, Number.NaN, 4096.5])('blocks an invalid effective window %s despite advertised capacity', (effectiveContextTokens) => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-preflight-'))
    try {
      const result = runPreflight(workspacePath, { effectiveContextTokens })
      expect(result.ready).toBe(false)
      expect(result.checks.find((check) => check.id === 'context')).toMatchObject({ passed: false, blocking: true })
    } finally {
      fs.rmSync(workspacePath, { recursive: true, force: true })
    }
  })

  it('reports missing optional tools without blocking the run', () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-preflight-'))
    try {
      const result = runPreflight(workspacePath, { toolchain: { ...tools, python: false } })
      expect(result.ready).toBe(true)
      expect(result.checks.find((check) => check.id === 'toolchain')).toMatchObject({ passed: false, blocking: false })
    } finally {
      fs.rmSync(workspacePath, { recursive: true, force: true })
    }
  })
})
