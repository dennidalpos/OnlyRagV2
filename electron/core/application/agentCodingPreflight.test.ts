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
    ollamaReachable: true,
    workspacePath,
    isStandaloneMode: false,
    toolchain: tools,
    ...overrides,
  })
}

describe('Agent Coding preflight', () => {
  it('accepts a qualified installed model in a writable confined workspace', () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-preflight-'))
    try {
      expect(runPreflight(workspacePath)).toMatchObject({ ready: true })
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
      expect(result.checks.filter((check) => check.blocking && !check.passed).map((check) => check.id)).toEqual([
        'ollama', 'model', 'qualification', 'context',
      ])
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
