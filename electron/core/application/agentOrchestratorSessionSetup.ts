import fs from 'node:fs'
import { logger } from '../../diagnostics'
import { isProtectedSystemDirectory } from '../domain/agent/contextFilter'
import type { AgentTaskPayload } from '../domain/agent/agentTypes'
import type { AppSettings } from '../../../shared/types'
import { getDefaultAppSettings } from '../domain/settings/appSettingsDomain'
import { standaloneScratchWorkspace } from '../infrastructure/filesystem/standaloneScratchWorkspace'

/** Resolves the effective workspace directory for a run: 1. */
export function resolveWorkspacePath(
  payload: Pick<AgentTaskPayload, 'workspacePath' | 'isStandaloneMode' | 'sessionId'>,
  scratchWorkspace: Pick<typeof standaloneScratchWorkspace, 'getPath'> = standaloneScratchWorkspace,
): string | null {
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

  // Standalone mode owns one visible, persistent scratch workspace under userData.
  if (payload.isStandaloneMode) {
    try {
      return scratchWorkspace.getPath()
    } catch (err: any) {
      logger.log('WARN', 'AgentOrchestratorApp', `Could not create the standalone scratch workspace: ${err.message}`)
      return null
    }
  }

  return null
}

/**
 * Fallback settings used only when the caller (renderer) didn't supply any. Derived from the
 * canonical defaults so the fallback is fail-closed: no terminal, no file writes, offline-strict.
 */
export function buildDefaultAgentSettings(): AppSettings {
  return {
    ...getDefaultAppSettings(),
    defaultModel: 'llama3.2',
    codingModel: 'llama3.2',
    translationModel: 'llama3.2',
    visionModel: 'llama3.2-vision',
    embeddingModel: 'nomic-embed-text',
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
