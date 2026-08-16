import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { agentToolExecutorService } from './agentToolExecutorService'
import type { AppSettings } from '../../../src/types'

describe('AgentToolExecutorService Unit Tests', () => {
  let tempDir: string
  const settings: AppSettings = {
    defaultModel: 'llama3.2',
    hardwareProfile: 'Auto',
    ocrEngine: 'native_cuda',
    ollamaHost: '',
    codingModel: 'llama3.2',
    translationModel: 'llama3.2',
    visionModel: 'llama3.2-vision',
    embeddingModel: 'nomic-embed-text',
    complexityFastModel: 'llama3.2:3b',
    complexityStandardModel: 'qwen2.5-coder:7b',
    complexityDeepModel: 'deepseek-r1:8b',
    useComplexityRouting: true,
    allowTerminalExecution: true,
    allowFileModifications: true,
    customPromptOverrides: {},
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-executor-test-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('should execute write_file and read_file successfully', async () => {
    const filePath = path.join(tempDir, 'test.txt')
    const writeRes = await agentToolExecutorService.executeTool(
      {
        tool: 'write_file',
        parameters: { filePath, content: 'Hello AI Agent' },
      },
      tempDir,
      settings
    )

    expect(writeRes.outputForHistory).toContain('Successfully wrote file')
    expect(fs.existsSync(filePath)).toBe(true)

    const readRes = await agentToolExecutorService.executeTool(
      {
        tool: 'read_file',
        parameters: { filePath },
      },
      tempDir,
      settings
    )

    expect(readRes.outputForHistory).toContain('Hello AI Agent')
  })

  it('should extract code symbols from TypeScript file', async () => {
    const filePath = path.join(tempDir, 'symbols.ts')
    const codeContent = `
export interface UserDTO {
  id: string;
  name: string;
}

export type UserRole = 'admin' | 'user';

export class UserService {
  getUser(): UserDTO {
    return { id: '1', name: 'Alice' };
  }
}

export async function fetchAllUsers(): Promise<UserDTO[]> {
  return [];
}

export const processUserData = async (data: UserDTO) => {
  return data;
};
`
    fs.writeFileSync(filePath, codeContent, 'utf-8')

    const res = await agentToolExecutorService.executeTool(
      {
        tool: 'extract_code_symbols',
        parameters: { filePath },
      },
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('[CODE SYMBOLS:')
    expect(res.outputForHistory).toContain('[interface] UserDTO')
    expect(res.outputForHistory).toContain('[type] UserRole')
    expect(res.outputForHistory).toContain('[class] UserService')
    expect(res.outputForHistory).toContain('[function] fetchAllUsers')
    expect(res.outputForHistory).toContain('[function] processUserData')
  })

  it('should extract filtered code symbols from Python file', async () => {
    const pyPath = path.join(tempDir, 'models.py')
    const pyContent = `
class BaseModel:
    pass

class UserModel(BaseModel):
    def get_id(self):
        return 1

async def async_handler():
    return True
`
    fs.writeFileSync(pyPath, pyContent, 'utf-8')

    // Filter only classes
    const res = await agentToolExecutorService.executeTool(
      {
        tool: 'extract_code_symbols',
        parameters: { filePath: pyPath, symbolType: 'class' },
      },
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('[class] BaseModel')
    expect(res.outputForHistory).toContain('[class] UserModel')
    expect(res.outputForHistory).not.toContain('[function] async_handler')
  })

  it('should execute replace_file_content and return auto-healing feedback if chunk is not found', async () => {
    const filePath = path.join(tempDir, 'replace.ts')
    fs.writeFileSync(filePath, 'const a = 1;\nconst b = 2;\n', 'utf-8')

    const successRes = await agentToolExecutorService.executeTool(
      {
        tool: 'replace_file_content',
        parameters: { filePath, targetContent: 'const a = 1;', replacementContent: 'const a = 100;' },
      },
      tempDir,
      settings
    )

    expect(successRes.outputForHistory).toContain('Successfully replaced content')

    const failRes = await agentToolExecutorService.executeTool(
      {
        tool: 'replace_file_content',
        parameters: { filePath, targetContent: 'non_existent_code_chunk', replacementContent: 'const x = 0;' },
      },
      tempDir,
      settings
    )

    expect(failRes.outputForHistory).toContain('[REPLACE FILE ERROR')
  })

  it('should block destructive shell commands via command security guardrail', async () => {
    const res = await agentToolExecutorService.executeTool(
      {
        tool: 'run_command',
        parameters: { command: 'git reset --hard HEAD' },
      },
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('[SECURITY GUARDRAIL BLOCK]')
    expect(res.logMessage).toContain('[SECURITY BLOCK]')
  })

  it('should execute get_file_info and return correct file metadata', async () => {
    const filePath = path.join(tempDir, 'info_test.ts')
    fs.writeFileSync(filePath, 'line 1\nline 2\nline 3', 'utf-8')

    const res = await agentToolExecutorService.executeTool(
      {
        tool: 'get_file_info',
        parameters: { filePath },
      },
      tempDir,
      settings
    )

    expect(res.outputForHistory).toContain('[FILE INFO:')
    expect(res.outputForHistory).toContain('Type: File')
    expect(res.outputForHistory).toContain('Line Count: 3')
    expect(res.outputForHistory).toContain('Is Binary: false')
  })

  it('should execute rollback_workspace and restore modified file state', async () => {
    const filePath = path.join(tempDir, 'rollback_test.txt')
    fs.writeFileSync(filePath, 'Original State', 'utf-8')

    // Modify file via executor (triggers journal recording)
    await agentToolExecutorService.executeTool(
      {
        tool: 'write_file',
        parameters: { filePath, content: 'Modified State' },
      },
      tempDir,
      settings
    )

    expect(fs.readFileSync(filePath, 'utf-8')).toBe('Modified State')

    // Trigger rollback
    const rollbackRes = await agentToolExecutorService.executeTool(
      {
        tool: 'rollback_workspace',
        parameters: {},
      },
      tempDir,
      settings
    )

    expect(rollbackRes.outputForHistory).toContain('[ATOMIC WORKSPACE ROLLBACK EXECUTED]')
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('Original State')
  })

  it('should execute git_status and git_diff without errors', async () => {
    const statusRes = await agentToolExecutorService.executeTool(
      {
        tool: 'git_status',
        parameters: {},
      },
      process.cwd(),
      settings
    )
    expect(statusRes.outputForHistory).toContain('[GIT STATUS:')

    const diffRes = await agentToolExecutorService.executeTool(
      {
        tool: 'git_diff',
        parameters: {},
      },
      process.cwd(),
      settings
    )
    expect(diffRes.outputForHistory).toContain('[GIT DIFF')
  })
})

