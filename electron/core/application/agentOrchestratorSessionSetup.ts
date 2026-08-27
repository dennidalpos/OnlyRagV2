import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { logger } from '../../diagnostics'
import { isProtectedSystemDirectory } from '../domain/agent/contextFilter'
import type { AgentTaskPayload } from '../domain/agent/agentTypes'
import type { AppSettings } from '../../../src/types'

/**
 * Resolves the effective workspace directory for a run:
 * 1. If a valid user workspace path is provided, validates safety and creates if missing.
 * 2. If running standalone or no workspace is specified, allocates an isolated temporary
 *    per-session scratch directory in %TEMP%/onlyrag_sessions/<sessionId>.
 */
export function resolveWorkspacePath(payload: Pick<AgentTaskPayload, 'workspacePath' | 'isStandaloneMode' | 'sessionId'>): string | null {
  const rawPath = payload.workspacePath ? payload.workspacePath.trim() : null
  if (rawPath && !isProtectedSystemDirectory(rawPath)) {
    if (!fs.existsSync(rawPath)) {
      try {
        fs.mkdirSync(rawPath, { recursive: true })
      } catch (err: any) {
        logger.log('WARN', 'AgentOrchestratorApp', `Could not create workspace directory '${rawPath}': ${err.message}`)
      }
    }
    if (fs.existsSync(rawPath)) {
      return rawPath
    }
  }

  // Standalone / Chat Libera mode: allocate an isolated user temp scratch directory
  if (payload.isStandaloneMode) {
    const sessionSubdir = payload.sessionId ? payload.sessionId.replace(/[^a-zA-Z0-9_-]/g, '_') : `standalone-${Date.now()}`
    const tempBase = path.join(os.tmpdir(), 'onlyrag_sessions', sessionSubdir)
    try {
      if (!fs.existsSync(tempBase)) {
        fs.mkdirSync(tempBase, { recursive: true })
      }
      return tempBase
    } catch (err: any) {
      logger.log('WARN', 'AgentOrchestratorApp', `Could not create temp session directory '${tempBase}': ${err.message}`)
      return null
    }
  }

  return null
}

/** Fallback settings used only when the caller (renderer) didn't supply any. */
export function buildDefaultAgentSettings(): AppSettings {
  return {
    defaultModel: 'llama3.2',
    ocrEngine: 'native_cuda',
    ollamaHost: '',
    codingModel: 'llama3.2',
    translationModel: 'llama3.2',
    visionModel: 'llama3.2-vision',
    embeddingModel: 'nomic-embed-text',
    allowTerminalExecution: true,
    allowFileModifications: true,
    customPromptOverrides: {},
  }
}

/** Renders every attached RAG document into the `[ATTACHED DOCUMENT: ...]` prompt block. */
export function buildAttachedContextBlock(payload: Pick<AgentTaskPayload, 'attachedDocs'>): string {
  return (payload.attachedDocs || [])
    .map((d) => `[ATTACHED DOCUMENT: ${d.filename}]\n${(d.extractedMarkdown || '').slice(0, 3000)}`)
    .join('\n\n')
}

/**
 * Renders every explicitly pinned file into the `[EXPLICIT REFERENCED FILE: ...]` prompt
 * block, reading content from disk when the payload didn't already carry it inline.
 */
export function buildPinnedFilesContextBlock(payload: Pick<AgentTaskPayload, 'pinnedFiles'>): string {
  return (payload.pinnedFiles || [])
    .map((f) => {
      let content = f.content || ''
      if (!content && f.path && fs.existsSync(f.path)) {
        try {
          content = fs.readFileSync(f.path, 'utf-8')
        } catch (err: any) {
          logger.log('WARN', 'AgentOrchestratorApp', `Could not read pinned file ${f.path}: ${err.message}`)
        }
      }
      return `[EXPLICIT REFERENCED FILE: ${f.name} (${f.path})]\n\`\`\`\n${(content || '').slice(0, 12000)}\n\`\`\``
    })
    .join('\n\n')
}
