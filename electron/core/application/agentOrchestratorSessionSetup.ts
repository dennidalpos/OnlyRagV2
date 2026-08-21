import fs from 'node:fs'
import { logger } from '../../diagnostics'
import { isProtectedSystemDirectory } from '../domain/agent/contextFilter'
import type { AgentTaskPayload } from '../domain/agent/agentTypes'
import type { AppSettings } from '../../../src/types'

/**
 * Resolves the effective workspace directory for a run: redirects out of protected system
 * directories, falls back to the Desktop test_app scratch folder when nothing was supplied
 * (unless running standalone), and ensures the resolved directory exists on disk.
 */
export function resolveWorkspacePath(payload: Pick<AgentTaskPayload, 'workspacePath' | 'isStandaloneMode'>): string | null {
  const rawPath = payload.workspacePath ? payload.workspacePath.trim() : null
  if (!rawPath) {
    return null
  }
  if (isProtectedSystemDirectory(rawPath)) {
    logger.log('WARN', 'AgentOrchestratorApp', `Provided workspace '${rawPath}' is inside a protected system directory.`)
    return null
  }
  if (!fs.existsSync(rawPath)) {
    try {
      fs.mkdirSync(rawPath, { recursive: true })
    } catch (err: any) {
      logger.log('WARN', 'AgentOrchestratorApp', `Could not create workspace directory '${rawPath}': ${err.message}`)
      return null
    }
  }
  return rawPath
}

/** Fallback settings used only when the caller (renderer) didn't supply any. */
export function buildDefaultAgentSettings(): AppSettings {
  return {
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
