import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TaskRunner, normalizePowerShellCommand } from './taskRunner'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('TaskRunner Unit & Reliability Tests', () => {
  let runner: TaskRunner

  beforeEach(() => {
    runner = new TaskRunner()
  })

  it('should register and unregister active tasks correctly', () => {
    const destroyMock = vi.fn()
    const taskId = runner.registerActiveTask('task-1', 'terminal_command', destroyMock)

    expect(taskId).toBe('task-1')
    runner.unregisterActiveTask('task-1')

    // Cancelling after unregister should return not found
    const cancelRes = runner.cancelTask('task-1')
    expect(cancelRes.success).toBe(false)
    expect(destroyMock).not.toHaveBeenCalled()
  })

  it('should cancel active task and clean up file residue safely', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-taskrunner-test-'))
    const tempFile = path.join(tempDir, 'partial.tmp')
    fs.writeFileSync(tempFile, 'partial residue data', 'utf-8')

    const destroyMock = vi.fn()
    runner.registerActiveTask('task-to-cancel', 'ingestion', destroyMock, tempFile)

    const cancelRes = runner.cancelTask('task-to-cancel')
    expect(cancelRes.success).toBe(true)
    expect(destroyMock).toHaveBeenCalledOnce()
    expect(fs.existsSync(tempFile)).toBe(false)

    // Cleanup temp dir
    try {
      fs.rmdirSync(tempDir)
    } catch {}
  })

  it('should cancel all active tasks on cancelAllTasks', () => {
    const d1 = vi.fn()
    const d2 = vi.fn()
    runner.registerActiveTask('t1', 'ollama_stream', d1)
    runner.registerActiveTask('t2', 'export', d2)

    runner.cancelAllTasks()
    expect(d1).toHaveBeenCalledOnce()
    expect(d2).toHaveBeenCalledOnce()
  })

  it('should normalize compound && commands to valid PowerShell conditional syntax', () => {
    const input = 'cd project-dashboard-task && npm install tailwindcss postcss autoprefixer'
    const normalized = normalizePowerShellCommand(input)
    expect(normalized).toBe('cd project-dashboard-task; if ($?) { npm install tailwindcss postcss autoprefixer }')

    const multi = 'npm install && npm test && npm run build'
    const multiNormalized = normalizePowerShellCommand(multi)
    expect(multiNormalized).toBe('npm install; if ($?) { npm test; if ($?) { npm run build } }')
  })

  it('should inject non-interactive flags for npx and create-vite commands', () => {
    const npxCmd = 'npx create-react-app my-app'
    expect(normalizePowerShellCommand(npxCmd)).toBe('npx -y create-react-app my-app')

    const viteCmd = 'npm create vite@latest . --template react-ts'
    expect(normalizePowerShellCommand(viteCmd)).toBe('npm create vite@latest . -- --template react-ts --yes')

    const viteAlreadyYes = 'npm create vite@latest . -- --template react-ts --yes'
    expect(normalizePowerShellCommand(viteAlreadyYes)).toBe('npm create vite@latest . -- --template react-ts --yes')
  })

  it('should reject invalid command safely', async () => {
    const res = await runner.executeTerminalCommand('')
    expect(res.success).toBe(false)
    expect(res.error).toBe('Invalid command')
  })

  it('should execute simple PowerShell command and return clean output', async () => {
    const res = await runner.executeTerminalCommand('Write-Output "TaskRunnerReliabilityCheck"', undefined, undefined, 10000)
    expect(res.success).toBe(true)
    expect(res.output).toContain('TaskRunnerReliabilityCheck')
  })
})
