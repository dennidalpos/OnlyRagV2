import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { resolveWorkspacePath, buildDefaultAgentSettings, buildAttachedContextBlock, buildPinnedFilesContextBlock } from './agentOrchestratorSessionSetup'

describe('agentOrchestratorSessionSetup', () => {
  const createdDirs: string[] = []

  afterEach(() => {
    for (const d of createdDirs) {
      try {
        if (fs.existsSync(d)) {
          fs.rmSync(d, { recursive: true, force: true })
        }
      } catch {}
    }
    createdDirs.length = 0
  })

  it('should resolve a valid workspace path and ensure directory exists', () => {
    const tempDir = path.join(os.tmpdir(), `test_ws_${Date.now()}`)
    createdDirs.push(tempDir)

    const resolved = resolveWorkspacePath({ workspacePath: tempDir, isStandaloneMode: false })
    expect(resolved).toBe(tempDir)
    expect(fs.existsSync(tempDir)).toBe(true)
  })

  it('should allocate an isolated temp session workspace when in standalone mode or without workspacePath', () => {
    const sessionId = `test-session-${Date.now()}`
    const resolved = resolveWorkspacePath({ workspacePath: null, isStandaloneMode: true, sessionId } as any)
    expect(resolved).not.toBeNull()
    expect(resolved).toContain('onlyrag_sessions')
    expect(resolved).toContain(sessionId)
    expect(fs.existsSync(resolved!)).toBe(true)
    if (resolved) createdDirs.push(resolved)
  })

  it('should return null when workspacePath is inside protected system directory and not standalone', () => {
    const sessionId = `sys-blocked-${Date.now()}`
    const resolved = resolveWorkspacePath({
      workspacePath: 'C:\\Program Files\\OnlyRag V2',
      isStandaloneMode: false,
      sessionId,
    } as any)
    expect(resolved).toBeNull()
  })

  it('should fallback to temp workspace when in standalone mode even with protected or empty workspace', () => {
    const sessionId = `sys-standalone-${Date.now()}`
    const resolved = resolveWorkspacePath({
      workspacePath: 'C:\\Program Files\\OnlyRag V2',
      isStandaloneMode: true,
      sessionId,
    } as any)
    expect(resolved).not.toBeNull()
    expect(resolved).toContain('onlyrag_sessions')
    expect(fs.existsSync(resolved!)).toBe(true)
    if (resolved) createdDirs.push(resolved)
  })

  it('should build default agent settings properly', () => {
    const settings = buildDefaultAgentSettings()
    expect(settings.defaultModel).toBe('llama3.2')
    expect(settings.allowFileModifications).toBe(true)
    expect(settings.allowTerminalExecution).toBe(true)
  })

  it('should format attached context and pinned files blocks', () => {
    const attached = buildAttachedContextBlock({
      attachedDocs: [{ id: 'doc-1', filename: 'manual.pdf', extractedMarkdown: 'Manual content here' }],
    })
    expect(attached).toContain('[ATTACHED DOCUMENT: manual.pdf]')
    expect(attached).toContain('Manual content here')

    const pinned = buildPinnedFilesContextBlock({
      pinnedFiles: [{ name: 'index.html', path: 'index.html', content: '<h1>Hello</h1>' }],
    })
    expect(pinned).toContain('[EXPLICIT REFERENCED FILE: index.html (index.html)]')
    expect(pinned).toContain('<h1>Hello</h1>')
  })
})
