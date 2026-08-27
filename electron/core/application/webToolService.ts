import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { AgentToolCall } from '../domain/agent/agentTypes'
import { validatePathSafety } from '../domain/agent/contextFilter'
import type { ToolExecutionResult } from '../domain/agent/tools/toolExecutionContracts'
import { webClient } from '../infrastructure/http/webClient'
import { executeWebContentFetch, executeWebSearch } from '../domain/agent/tools/web/webResearchTools'

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
      return { outputForHistory: 'Direct file download disabled in Settings.', logMessage: 'File download disabled in settings' }
    }

    const url = parameters.url
    const filePath = parameters.filePath
    const pathCheck = validatePathSafety(filePath, workspacePath)
    if (!pathCheck.safePath) {
      return { outputForHistory: `Security Violation: ${pathCheck.error}`, logMessage: `Download File Rejected: ${pathCheck.error}` }
    }
    if (!url || !filePath) {
      return { outputForHistory: 'Missing URL or file path for download', logMessage: 'Missing download parameters' }
    }

    this.dependencies.recordBeforeModification(pathCheck.safePath)
    const downloadFile = this.dependencies.downloadFile || ((targetUrl, targetPath, workspaceRoot, abortSignal) =>
      webClient.downloadFile(targetUrl, targetPath, workspaceRoot, abortSignal))
    const result = await downloadFile(url, pathCheck.safePath, workspacePath, signal)
    if (!result.success) {
      return { outputForHistory: `Download failed from ${url}: ${result.error}`, logMessage: `Download File Failed: ${result.error}` }
    }

    const hashFile = this.dependencies.hashFile || ((targetPath: string) =>
      crypto.createHash('sha256').update(fs.readFileSync(targetPath)).digest('hex'))
    const provenance = hashFile(pathCheck.safePath)
    return {
      outputForHistory: `Successfully downloaded ${result.downloadedBytes} bytes from ${url} to ${filePath}\nProvenance SHA-256: ${provenance}`,
      logMessage: `Successfully downloaded ${result.downloadedBytes} bytes to ${path.basename(filePath)}`,
      logDetail: `SHA-256: ${provenance}`,
    }
  }
}
