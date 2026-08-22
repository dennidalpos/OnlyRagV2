import { describe, it, expect } from 'vitest'
import { validateAndSanitize } from './toolSchemaValidator'
import type { AgentToolCall } from './agentTypes'

describe('ToolSchemaValidator Unit Tests', () => {
  it('should validate and coerce read_file parameters correctly', () => {
    const raw: AgentToolCall = {
      tool: 'read_file',
      parameters: { path: 'src/main.ts', startLine: '10', endLine: '50' } as any,
    }
    const res = validateAndSanitize(raw)
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
    const res = validateAndSanitize(raw)
    expect(res.valid).toBe(false)
    expect(res.errors.length).toBeGreaterThan(0)
    expect(res.errors[0]).toContain('targetContent')
  })

  it('should sanitize and coerce run_command parameters properly', () => {
    const raw: AgentToolCall = {
      tool: 'run_command',
      parameters: { cmd: 'npm test', timeoutMs: '120000' } as any,
    }
    const res = validateAndSanitize(raw)
    expect(res.valid).toBe(true)
    expect(res.sanitizedToolCall.parameters?.command).toBe('npm test')
    expect(res.sanitizedToolCall.parameters?.timeoutMs).toBe(120000)
  })

  it('should validate run_tests with no parameters (command is optional — auto-detected when omitted)', () => {
    const raw: AgentToolCall = { tool: 'run_tests', parameters: {} }
    const res = validateAndSanitize(raw)
    expect(res.valid).toBe(true)
    expect(res.sanitizedToolCall.parameters?.command).toBeUndefined()
  })

  it('should coerce an explicit run_tests command override to a string', () => {
    const raw: AgentToolCall = {
      tool: 'run_tests',
      parameters: { command: 'pytest -k test_login -q' },
    }
    const res = validateAndSanitize(raw)
    expect(res.valid).toBe(true)
    expect(res.sanitizedToolCall.parameters?.command).toBe('pytest -k test_login -q')
  })

  it('should validate and coerce git_commit parameters correctly', () => {
    const raw: AgentToolCall = {
      tool: 'git_commit',
      parameters: { commitMessage: 'Fix login bug' },
    }
    const res = validateAndSanitize(raw)
    expect(res.valid).toBe(true)
    expect(res.sanitizedToolCall.parameters?.commitMessage).toBe('Fix login bug')
  })

  it('should detect missing required commitMessage for git_commit', () => {
    const raw: AgentToolCall = { tool: 'git_commit', parameters: {} }
    const res = validateAndSanitize(raw)
    expect(res.valid).toBe(false)
    expect(res.errors[0]).toContain('commitMessage')
  })

  it('should accept update_plan with milestoneId aliases and normalise the status casing', () => {
    const res = validateAndSanitize({
      tool: 'update_plan',
      parameters: { id: 'm-2', status: 'In Progress' },
    } as AgentToolCall)

    expect(res.valid).toBe(true)
    expect(res.sanitizedToolCall.parameters.milestoneId).toBe('m-2')
    expect(res.sanitizedToolCall.parameters.status).toBe('in_progress')
  })

  it('should reject update_plan with an unknown status or a missing milestone reference', () => {
    const badStatus = validateAndSanitize({
      tool: 'update_plan',
      parameters: { milestoneId: 'm-1', status: 'almost_done' },
    } as AgentToolCall)
    expect(badStatus.valid).toBe(false)
    expect(badStatus.errors.join(' ')).toContain('status')

    const noId = validateAndSanitize({
      tool: 'update_plan',
      parameters: { status: 'verified' },
    } as AgentToolCall)
    expect(noId.valid).toBe(false)
    expect(noId.errors.join(' ')).toContain('milestoneId')
  })

  it('should accept replace_file_content with old_str and new_str aliases', () => {
    const raw: AgentToolCall = {
      tool: 'replace_file_content',
      parameters: { file_path: 'src/App.tsx', old_str: 'const a = 1', new_str: 'const a = 2' } as any,
    }
    const res = validateAndSanitize(raw)
    expect(res.valid).toBe(true)
    expect(res.sanitizedToolCall.parameters.filePath).toBe('src/App.tsx')
    expect(res.sanitizedToolCall.parameters.targetContent).toBe('const a = 1')
    expect(res.sanitizedToolCall.parameters.replacementContent).toBe('const a = 2')
  })

  it('should accept multi_replace_file_content with replacements or chunks array', () => {
    const raw: AgentToolCall = {
      tool: 'multi_replace_file_content',
      parameters: {
        file: 'src/index.ts',
        replacements: [{ target: 'old', replacement: 'new' }],
      } as any,
    }
    const res = validateAndSanitize(raw)
    expect(res.valid).toBe(true)
    expect(res.sanitizedToolCall.parameters.filePath).toBe('src/index.ts')
    expect(res.sanitizedToolCall.parameters.replacements).toHaveLength(1)
    expect(res.sanitizedToolCall.parameters.replacements?.[0]?.targetContent).toBe('old')
    expect(res.sanitizedToolCall.parameters.replacements?.[0]?.replacementContent).toBe('new')
  })

  it('should validate and coerce create_directory parameters and detect missing dirPath', () => {
    const valid = validateAndSanitize({
      tool: 'create_directory',
      parameters: { path: 'src/utils' } as any,
    })
    expect(valid.valid).toBe(true)
    expect(valid.sanitizedToolCall.parameters.dirPath).toBe('src/utils')

    const invalid = validateAndSanitize({
      tool: 'create_directory',
      parameters: {} as any,
    })
    expect(invalid.valid).toBe(false)
    expect(invalid.errors[0]).toContain('dirPath')
  })

  it('should validate and coerce copy_file and move_file sourcePath and targetPath', () => {
    const validCopy = validateAndSanitize({
      tool: 'copy_file',
      parameters: { source: 'src/a.ts', destination: 'src/b.ts' } as any,
    })
    expect(validCopy.valid).toBe(true)
    expect(validCopy.sanitizedToolCall.parameters.sourcePath).toBe('src/a.ts')
    expect(validCopy.sanitizedToolCall.parameters.targetPath).toBe('src/b.ts')

    const invalidMove = validateAndSanitize({
      tool: 'move_file',
      parameters: { source: 'src/a.ts' } as any,
    })
    expect(invalidMove.valid).toBe(false)
    expect(invalidMove.errors[0]).toContain('targetPath')
  })

  it('should validate list_files_recursive default and maxDepth bounds', () => {
    const resDefault = validateAndSanitize({
      tool: 'list_files_recursive',
      parameters: {} as any,
    })
    expect(resDefault.valid).toBe(true)
    expect(resDefault.sanitizedToolCall.parameters.dirPath).toBe('.')

    const resDepth = validateAndSanitize({
      tool: 'list_files_recursive',
      parameters: { dirPath: 'src', maxDepth: '10' } as any,
    })
    expect(resDepth.valid).toBe(true)
    expect(resDepth.sanitizedToolCall.parameters.maxDepth).toBe(6) // clamped to 6
  })
})

