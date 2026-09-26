import crypto from 'node:crypto'
import { documentIoRepository } from '../infrastructure/filesystem/documentIoRepository'
import path from 'node:path'
import type { AgentToolCall } from '../domain/agent/agentTypes'
import { validatePathSafety } from '../domain/agent/contextFilter'
import type { ToolExecutionResult } from '../domain/agent/tools/toolExecutionContracts'
import { webClient } from '../infrastructure/http/webClient'
import { executeWebContentFetch, executeWebSearch } from '../domain/agent/tools/web/webResearchTools'
import { toolLog } from '../domain/agent/tools/toolExecutionContracts'

interface WebToolDependencies {
  downloadFile?: (
    url: string,
    targetFilePath: string,
    workspaceRoot: string | null | undefined,
    signal: AbortSignal | undefined,
  ) => Promise<{ success: boolean; downloadedBytes?: number; error?: string }>
  recordBeforeModification: (filePath: string) => void
  hashFile?: (filePath: string) => string
}

/** Application service for guarded download execution and artifact provenance. */
export class WebToolService {
  constructor(private readonly dependencies: WebToolDependencies) {}

  executeSearch(query: string, maxResults: number, signal: AbortSignal | undefined): Promise<ToolExecutionResult> {
    return executeWebSearch(query, maxResults, (searchQuery, limit) => webClient.searchWeb(searchQuery, limit, signal))
  }

  executeFetch(url: string, signal: AbortSignal | undefined): Promise<ToolExecutionResult> {
    return executeWebContentFetch(url, (targetUrl) => webClient.fetchWebContent(targetUrl, 16000, signal))
  }

  async executeDownloadFile(
    parameters: AgentToolCall['parameters'],
    workspacePath: string | null | undefined,
    allowFileModifications: boolean | undefined,
    signal: AbortSignal | undefined,
  ): Promise<ToolExecutionResult> {
    if (allowFileModifications === false) {
      return { outcome: 'blocked', outputForHistory: 'Direct file download disabled in Settings.', ...toolLog('toolDownloadDisabled') }
    }

    const url = parameters.url
    const filePath = parameters.filePath
    const pathCheck = validatePathSafety(filePath, workspacePath)
    if (!pathCheck.safePath) {
      return {
        outcome: 'rejected',
        outputForHistory: `Security Violation: ${pathCheck.error}`,
        ...toolLog('toolEditPathRejected', { tool: 'download_file', error: String(pathCheck.error) }),
      }
    }
    if (!url || !filePath) {
      return { outcome: 'rejected', outputForHistory: 'Missing URL or file path for download', ...toolLog('toolEditMissingParams', { tool: 'download_file' }) }
    }

    this.dependencies.recordBeforeModification(pathCheck.safePath)
    const downloadFile =
      this.dependencies.downloadFile ||
      ((targetUrl, targetPath, workspaceRoot, abortSignal) => webClient.downloadFile(targetUrl, targetPath, workspaceRoot, abortSignal))
    const result = await downloadFile(url, pathCheck.safePath, workspacePath, signal)
    if (!result.success) {
      return {
        outcome: 'failure',
        outputForHistory: `Download failed from ${url}: ${result.error}`,
        ...toolLog('toolDownloadFailed', { error: String(result.error) }),
      }
    }

    const hashFile =
      this.dependencies.hashFile || ((targetPath: string) => crypto.createHash('sha256').update(documentIoRepository.readBytes(targetPath)).digest('hex'))
    const provenance = hashFile(pathCheck.safePath)
    return {
      outcome: 'success',
      outputForHistory: `Successfully downloaded ${result.downloadedBytes} bytes from ${url} to ${filePath}\nProvenance SHA-256: ${provenance}`,
      ...toolLog('toolDownloadDone', { bytes: Number(result.downloadedBytes ?? 0), file: path.basename(filePath) }),
      logDetail: `SHA-256: ${provenance}`,
    }
  }
}
