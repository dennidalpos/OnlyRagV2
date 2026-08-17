import { describe, it, expect } from 'vitest'
import { ToolSchemaValidator } from './toolSchemaValidator'
import type { AgentToolCall } from './agentTypes'

describe('ToolSchemaValidator Unit Tests', () => {
  it('should validate and coerce read_file parameters correctly', () => {
    const raw: AgentToolCall = {
      tool: 'read_file',
      parameters: { path: 'src/main.ts', startLine: '10', endLine: '50' } as any,
    }
    const res = ToolSchemaValidator.validateAndSanitize(raw)
    expect(res.valid).toBe(true)
    expect(res.sanitizedToolCall.parameters?.filePath).toBe('src/main.ts')
    expect(res.sanitizedToolCall.parameters?.startLine).toBe(10)
    expect(res.sanitizedToolCall.parameters?.endLine).toBe(50)
  })

  it('should detect missing required parameters for replace_file_content', () => {
    const raw: AgentToolCall = {
      tool: 'replace_file_content',
      parameters: { path: 'src/App.tsx' } as any,
    }
    const res = ToolSchemaValidator.validateAndSanitize(raw)
    expect(res.valid).toBe(false)
    expect(res.errors.length).toBeGreaterThan(0)
    expect(res.errors[0]).toContain('targetContent')
  })

  it('should sanitize and coerce run_command parameters properly', () => {
    const raw: AgentToolCall = {
      tool: 'run_command',
      parameters: { cmd: 'npm test', timeoutMs: '120000' } as any,
    }
    const res = ToolSchemaValidator.validateAndSanitize(raw)
    expect(res.valid).toBe(true)
    expect(res.sanitizedToolCall.parameters?.command).toBe('npm test')
    expect(res.sanitizedToolCall.parameters?.timeoutMs).toBe(120000)
  })

  it('should validate run_tests with no parameters (command is optional — auto-detected when omitted)', () => {
    const raw: AgentToolCall = { tool: 'run_tests', parameters: {} }
    const res = ToolSchemaValidator.validateAndSanitize(raw)
    expect(res.valid).toBe(true)
    expect(res.sanitizedToolCall.parameters?.command).toBeUndefined()
  })

  it('should coerce an explicit run_tests command override to a string', () => {
    const raw: AgentToolCall = {
      tool: 'run_tests',
      parameters: { command: 'pytest -k test_login -q' },
    }
    const res = ToolSchemaValidator.validateAndSanitize(raw)
    expect(res.valid).toBe(true)
    expect(res.sanitizedToolCall.parameters?.command).toBe('pytest -k test_login -q')
  })

  it('should validate and coerce git_commit parameters correctly', () => {
    const raw: AgentToolCall = {
      tool: 'git_commit',
      parameters: { commitMessage: 'Fix login bug' },
    }
    const res = ToolSchemaValidator.validateAndSanitize(raw)
    expect(res.valid).toBe(true)
    expect(res.sanitizedToolCall.parameters?.commitMessage).toBe('Fix login bug')
  })

  it('should detect missing required commitMessage for git_commit', () => {
    const raw: AgentToolCall = { tool: 'git_commit', parameters: {} }
    const res = ToolSchemaValidator.validateAndSanitize(raw)
    expect(res.valid).toBe(false)
    expect(res.errors[0]).toContain('commitMessage')
  })
})
