import {
  DiagnosticsData,
  LogEntry,
  IngestedDocument,
  IngestedDocumentContent,
  VectorSearchResult,
  WorkspaceFile,
  SkillDefinition,
  HubSkillItem,
  SkillHubSource,
  CustomHubInput,
  SkillSaveInput,
} from '../types'
import { logger } from '../lib/logger'
import { errorMessage } from '../../shared/domain/errors/errorMessage'
import { translate } from '../i18n/I18nContext'

/**
 * Centralized Type-Safe API Service Abstraction for OnlyRag V2
 * Provides safe wrappers around Electron IPC API with automated telemetry logging.
 */
export const apiService = {
  async runDiagnostics(host?: string): Promise<DiagnosticsData | null> {
    if (!window.electronAPI) return null
    try {
      return await window.electronAPI.runDiagnostics(host)
    } catch (err: unknown) {
      logger.error('ApiService:Diagnostics', `Failed to run system diagnostics: ${errorMessage(err)}`)
      return null
    }
  },

  async getLogs(): Promise<LogEntry[]> {
    if (!window.electronAPI) return []
    try {
      return await window.electronAPI.getLogs()
    } catch (err: unknown) {
      logger.error('ApiService:Logs', `Failed to fetch logs: ${errorMessage(err)}`)
      return []
    }
  },

  async clearLogs(): Promise<boolean> {
    if (!window.electronAPI) return false
    try {
      return await window.electronAPI.clearLogs()
    } catch (err: unknown) {
      logger.error('ApiService:Logs', `Failed to clear logs: ${errorMessage(err)}`)
      return false
    }
  },

  async openLogsFolder(): Promise<{ success: boolean; path?: string; error?: string }> {
    if (!window.electronAPI?.openLogsFolder) return { success: false, error: 'Electron API unavailable' }
    try {
      return await window.electronAPI.openLogsFolder()
    } catch (err: unknown) {
      logger.error('ApiService:Logs', `Failed to open logs folder: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  },

  /** Resolves null when the document list could NOT be retrieved (sidecar unreachable, timeout, unparseable reply). */
  async getIngestedDocuments(): Promise<IngestedDocument[] | null> {
    if (!window.electronAPI) return null
    try {
      const docs = await window.electronAPI.getIngestedDocuments()
      return Array.isArray(docs) ? docs : null
    } catch (err: unknown) {
      logger.error('ApiService:Ingestion', `Failed to fetch ingested documents: ${errorMessage(err)}`)
      return null
    }
  },

  /** One document with its Markdown; the list carries metadata only. Null when it is missing or unreachable. */
  async getIngestedDocument(docId: string): Promise<IngestedDocumentContent | null> {
    if (!window.electronAPI?.getIngestedDocument) return null
    try {
      return (await window.electronAPI.getIngestedDocument(docId)) || null
    } catch (err: unknown) {
      logger.error('ApiService:Ingestion', `Failed to load document ${docId}: ${errorMessage(err)}`)
      return null
    }
  },

  async ingestFile(
    filePath: string,
    visionModel?: string,
    visionPrompt?: string,
    normalizeWithLlm?: boolean,
    normalizationModel?: string,
    numCtx?: number,
    taskId?: string,
    normalizationThink?: boolean,
  ): Promise<{ success: boolean; data?: IngestedDocumentContent; error?: string }> {
    if (!window.electronAPI) return { success: false, error: 'Electron API unavailable' }
    try {
      logger.info(
        'ApiService:Ingestion',
        `Initiating ingestion for file: ${filePath} (normalizeWithLlm=${normalizeWithLlm}, normalizationModel=${normalizationModel})`,
      )
      const res = await window.electronAPI.ingestFile(
        filePath,
        visionModel,
        visionPrompt,
        normalizeWithLlm,
        normalizationModel,
        numCtx,
        taskId,
        normalizationThink,
      )
      if (!res.success) {
        logger.warn('ApiService:Ingestion', `Ingestion warning/error: ${res.error}`)
      } else {
        window.dispatchEvent(new CustomEvent('onlyrag:documents-changed'))
      }
      return res
    } catch (err: unknown) {
      logger.error('ApiService:Ingestion', `Exception during file ingestion: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  },

  async updateIngestedDocument(docId: string, markdownContent: string): Promise<{ success: boolean; data?: IngestedDocumentContent; error?: string }> {
    if (!window.electronAPI) return { success: false, error: 'Electron API unavailable' }
    try {
      logger.info('ApiService:Ingestion', `Updating ingested document ${docId}`)
      const res = await window.electronAPI.updateIngestedDocument(docId, markdownContent)
      if (!res.success) {
        logger.warn('ApiService:Ingestion', `Update document warning/error: ${res.error}`)
      } else {
        window.dispatchEvent(new CustomEvent('onlyrag:documents-changed'))
      }
      return res
    } catch (err: unknown) {
      logger.error('ApiService:Ingestion', `Exception updating document ${docId}: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  },

  async translateDocumentInplace(
    docId: string,
    sourceLang: string,
    targetLang: string,
    model?: string,
    targetDir?: string,
    numCtx?: number,
    think?: boolean,
  ): Promise<{ success: boolean; data?: IngestedDocumentContent; error?: string }> {
    if (!window.electronAPI) return { success: false, error: 'Electron API unavailable' }
    try {
      logger.info('ApiService:Ingestion', `Translating document in place ${docId} (${sourceLang} -> ${targetLang})`)
      const res = await window.electronAPI.translateDocumentInplace(docId, sourceLang, targetLang, model, targetDir, numCtx, think)
      if (!res.success) {
        logger.warn('ApiService:Ingestion', `Translate in-place warning/error: ${res.error}`)
      } else {
        window.dispatchEvent(new CustomEvent('onlyrag:documents-changed'))
      }
      return res
    } catch (err: unknown) {
      logger.error('ApiService:Ingestion', `Exception translating document ${docId} in place: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  },

  async getDocumentPagePreview(docId: string, pageNumber: number) {
    if (!window.electronAPI?.getDocumentPagePreview) return null
    try {
      return await window.electronAPI.getDocumentPagePreview(docId, pageNumber)
    } catch (err: unknown) {
      logger.warn('ApiService:Ingestion', `Failed getting page preview for ${docId}, p.${pageNumber}: ${errorMessage(err)}`)
      return null
    }
  },

  async deleteIngestedDocument(docId: string): Promise<{ success: boolean; error?: string }> {
    if (!window.electronAPI) return { success: false, error: translate('services.electronApiUnavailable') }
    try {
      logger.info('ApiService:Ingestion', `Deleting document ${docId} from LanceDB`)
      const res = await window.electronAPI.deleteIngestedDocument(docId)
      if (res.success) {
        window.dispatchEvent(new CustomEvent('onlyrag:documents-changed'))
      }
      return res
    } catch (err: unknown) {
      logger.error('ApiService:Ingestion', `Failed deleting document ${docId}: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  },

  /** Rejects when the search itself fails, so callers can tell "no matches" from "search unavailable". */
  async searchVectorDb(query: string, topK: number = 5, docIds?: string[]): Promise<VectorSearchResult[]> {
    if (!window.electronAPI) return []
    return window.electronAPI.searchVectorDb(query, topK, docIds)
  },

  async exportDocument(markdownContent: string, format: string, outputFolder?: string): Promise<{ success: boolean; message?: string; error?: string }> {
    if (!window.electronAPI) return { success: false, error: 'Electron API unavailable' }
    try {
      return await window.electronAPI.exportDocument(markdownContent, format, outputFolder)
    } catch (err: unknown) {
      logger.error('ApiService:Export', `Export failed for format ${format}: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  },

  async listWorkspaceFiles(dirPath?: string): Promise<WorkspaceFile[]> {
    if (!window.electronAPI) return []
    try {
      return await window.electronAPI.listWorkspaceFiles(dirPath)
    } catch (err: unknown) {
      logger.error('ApiService:Workspace', `Failed listing files for ${dirPath || 'root'}: ${errorMessage(err)}`)
      return []
    }
  },

  async readWorkspaceFile(filePath: string): Promise<{ success: boolean; content?: string; error?: string }> {
    if (!window.electronAPI) return { success: false, error: 'Electron API unavailable' }
    try {
      return await window.electronAPI.readWorkspaceFile(filePath)
    } catch (err: unknown) {
      logger.error('ApiService:Workspace', `Failed reading file ${filePath}: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  },

  async writeWorkspaceFile(
    filePath: string,
    content: string,
    expectedContentHash?: string,
    workspaceRoot?: string,
  ): Promise<{ success: boolean; contentHash?: string; currentContentHash?: string; currentContent?: string; conflict?: boolean; error?: string }> {
    if (!window.electronAPI) return { success: false, error: 'Electron API unavailable' }
    try {
      logger.info('ApiService:Workspace', `Writing file content to ${filePath}`)
      return await window.electronAPI.writeWorkspaceFile(filePath, content, expectedContentHash, workspaceRoot)
    } catch (err: unknown) {
      logger.error('ApiService:Workspace', `Failed writing file ${filePath}: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  },

  async executePowerShellCommand(command: string, cwd?: string): Promise<{ success: boolean; output: string; error?: string }> {
    if (!window.electronAPI) return { success: false, output: '', error: 'Electron API unavailable' }
    try {
      logger.info('ApiService:PowerShell', `Executing command: ${command} in ${cwd || 'default'}`)
      return await window.electronAPI.executePowerShellCommand(command, cwd)
    } catch (err: unknown) {
      logger.error('ApiService:PowerShell', `PowerShell command execution error: ${errorMessage(err)}`)
      return { success: false, output: '', error: errorMessage(err) }
    }
  },

  async replaceWorkspaceFileChunk(filePath: string, targetContent: string, replacementContent: string): Promise<{ success: boolean; error?: string }> {
    if (!window.electronAPI) return { success: false, error: 'Electron API unavailable' }
    try {
      logger.info('ApiService:Workspace', `Replacing chunk in file: ${filePath}`)
      return await window.electronAPI.replaceWorkspaceFileChunk(filePath, targetContent, replacementContent)
    } catch (err: unknown) {
      logger.error('ApiService:Workspace', `Failed replacing chunk in ${filePath}: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  },

  async grepWorkspaceFiles(dirPath: string, query: string, isRegex?: boolean, caseInsensitive?: boolean) {
    if (!window.electronAPI) return []
    try {
      return await window.electronAPI.grepWorkspaceFiles(dirPath, query, isRegex, caseInsensitive)
    } catch (err: unknown) {
      logger.error('ApiService:Grep', `Grep search error: ${errorMessage(err)}`)
      return []
    }
  },

  async inspectGuestOsEnvironment() {
    if (!window.electronAPI) return null
    try {
      return await window.electronAPI.inspectGuestOsEnvironment()
    } catch (err: unknown) {
      logger.error('ApiService:GuestOs', `Failed inspecting guest OS: ${errorMessage(err)}`)
      return null
    }
  },

  async parseAgentToolCall(rawText: string) {
    if (!window.electronAPI) return null
    try {
      return await window.electronAPI.parseAgentToolCall(rawText)
    } catch (err: unknown) {
      logger.warn('ApiService:ToolParser', `IPC Tool Call Parse error: ${errorMessage(err)}`)
      return null
    }
  },

  async openFileDialog(options?: { title?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string[]> {
    if (!window.electronAPI?.openFileDialog) return []
    try {
      return await window.electronAPI.openFileDialog(options)
    } catch (err: unknown) {
      logger.error('ApiService:Dialog', `Open file dialog error: ${errorMessage(err)}`)
      return []
    }
  },

  async openDirectoryDialog(options?: { title?: string }): Promise<string | null> {
    if (!window.electronAPI?.openDirectoryDialog) return null
    try {
      return await window.electronAPI.openDirectoryDialog(options)
    } catch (err: unknown) {
      logger.error('ApiService:Dialog', `Open directory dialog error: ${errorMessage(err)}`)
      return null
    }
  },

  async searchWeb(query: string, maxResults?: number) {
    if (!window.electronAPI?.searchWeb) return { success: false, results: [], error: 'Electron API unavailable' }
    try {
      logger.info('ApiService:Web', `Initiating web search for "${query}"`)
      return await window.electronAPI.searchWeb(query, maxResults)
    } catch (err: unknown) {
      logger.error('ApiService:Web', `Web search failed for "${query}": ${errorMessage(err)}`)
      return { success: false, results: [], error: errorMessage(err) }
    }
  },

  async fetchWebContent(url: string, maxChars?: number) {
    if (!window.electronAPI?.fetchWebContent) return { success: false, error: 'Electron API unavailable' }
    try {
      logger.info('ApiService:Web', `Fetching web content from "${url}"`)
      return await window.electronAPI.fetchWebContent(url, maxChars)
    } catch (err: unknown) {
      logger.error('ApiService:Web', `Fetch web content failed for "${url}": ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  },

  async downloadFile(url: string, targetFilePath: string) {
    if (!window.electronAPI?.downloadFile) return { success: false, error: 'Electron API unavailable' }
    try {
      logger.info('ApiService:Web', `Downloading file from "${url}" to "${targetFilePath}"`)
      return await window.electronAPI.downloadFile(url, targetFilePath)
    } catch (err: unknown) {
      logger.error('ApiService:Web', `Download file failed for "${url}": ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  },

  async listInstalledSkills(workspaceRoot?: string): Promise<SkillDefinition[]> {
    if (!window.electronAPI?.listInstalledSkills) return []
    try {
      return await window.electronAPI.listInstalledSkills(workspaceRoot)
    } catch (err: unknown) {
      logger.error('ApiService:Skills', `Failed listing installed skills: ${errorMessage(err)}`)
      return []
    }
  },

  async listHubSources(): Promise<SkillHubSource[]> {
    if (!window.electronAPI?.listHubSources) return []
    try {
      return await window.electronAPI.listHubSources()
    } catch (err: unknown) {
      logger.error('ApiService:Skills', `Failed listing hub sources: ${errorMessage(err)}`)
      return []
    }
  },

  async addCustomHubSource(input: CustomHubInput): Promise<{ success: boolean; source?: SkillHubSource; error?: string }> {
    if (!window.electronAPI?.addCustomHubSource) return { success: false, error: 'Electron API unavailable' }
    try {
      return await window.electronAPI.addCustomHubSource(input)
    } catch (err: unknown) {
      logger.error('ApiService:Skills', `Failed adding custom hub: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  },

  async removeCustomHubSource(sourceId: string): Promise<{ success: boolean; error?: string }> {
    if (!window.electronAPI?.removeCustomHubSource) return { success: false, error: 'Electron API unavailable' }
    try {
      return await window.electronAPI.removeCustomHubSource(sourceId)
    } catch (err: unknown) {
      logger.error('ApiService:Skills', `Failed removing custom hub: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  },

  async listHubSkillsBySource(sourceId: string, workspaceRoot?: string, forceRefresh?: boolean): Promise<HubSkillItem[]> {
    if (!window.electronAPI?.listHubSkillsBySource) return []
    try {
      return await window.electronAPI.listHubSkillsBySource(sourceId, workspaceRoot, forceRefresh)
    } catch (err: unknown) {
      logger.error('ApiService:Skills', `Failed listing skills for hub ${sourceId}: ${errorMessage(err)}`)
      return []
    }
  },

  async listHubSkillsAcrossSources(workspaceRoot?: string, forceRefresh?: boolean): Promise<HubSkillItem[]> {
    if (!window.electronAPI?.listHubSkillsAcrossSources) return []
    try {
      return await window.electronAPI.listHubSkillsAcrossSources(workspaceRoot, forceRefresh)
    } catch (err: unknown) {
      logger.error('ApiService:Skills', `Failed listing skills across hubs: ${errorMessage(err)}`)
      return []
    }
  },

  async getHubSkillContent(item: HubSkillItem): Promise<{ success: boolean; content?: string; error?: string }> {
    if (!window.electronAPI?.getHubSkillContent) return { success: false, error: 'IPC unavailable' }
    try {
      return await window.electronAPI.getHubSkillContent(item)
    } catch (err: unknown) {
      logger.error('ApiService:Skills', `Failed fetching skill content for ${item.name}: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  },

  async toggleSkillActive(skillId: string, isActive: boolean): Promise<boolean> {
    if (!window.electronAPI?.toggleSkillActive) return false
    try {
      return await window.electronAPI.toggleSkillActive(skillId, isActive)
    } catch (err: unknown) {
      logger.error('ApiService:Skills', `Failed toggling skill ${skillId}: ${errorMessage(err)}`)
      return false
    }
  },

  async installSkillFromHub(
    hubSkillId: string,
    workspaceRoot?: string,
    hubSourceId?: string,
  ): Promise<{ success: boolean; skill?: SkillDefinition; error?: string }> {
    if (!window.electronAPI?.installSkillFromHub) return { success: false, error: 'Electron API unavailable' }
    try {
      return await window.electronAPI.installSkillFromHub(hubSkillId, workspaceRoot, hubSourceId)
    } catch (err: unknown) {
      logger.error('ApiService:Skills', `Failed installing hub skill ${hubSkillId}: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  },

  async installSkillFromUrl(url: string, workspaceRoot?: string, customName?: string): Promise<{ success: boolean; skill?: SkillDefinition; error?: string }> {
    if (!window.electronAPI?.installSkillFromUrl) return { success: false, error: 'Electron API unavailable' }
    try {
      return await window.electronAPI.installSkillFromUrl(url, workspaceRoot, customName)
    } catch (err: unknown) {
      logger.error('ApiService:Skills', `Failed installing skill from URL ${url}: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  },

  async saveCustomSkill(input: SkillSaveInput, workspaceRoot?: string): Promise<{ success: boolean; skill?: SkillDefinition; error?: string }> {
    if (!window.electronAPI?.saveCustomSkill) return { success: false, error: 'Electron API unavailable' }
    try {
      return await window.electronAPI.saveCustomSkill(input, workspaceRoot)
    } catch (err: unknown) {
      logger.error('ApiService:Skills', `Failed saving custom skill: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  },

  async resetSkillToOriginal(skillId: string, workspaceRoot?: string): Promise<{ success: boolean; skill?: SkillDefinition; error?: string }> {
    if (!window.electronAPI?.resetSkillToOriginal) return { success: false, error: 'Electron API unavailable' }
    try {
      return await window.electronAPI.resetSkillToOriginal(skillId, workspaceRoot)
    } catch (err: unknown) {
      logger.error('ApiService:Skills', `Failed resetting skill ${skillId}: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  },

  async uninstallSkill(skillId: string, workspaceRoot?: string): Promise<{ success: boolean; error?: string }> {
    if (!window.electronAPI?.uninstallSkill) return { success: false, error: 'Electron API unavailable' }
    try {
      return await window.electronAPI.uninstallSkill(skillId, workspaceRoot)
    } catch (err: unknown) {
      logger.error('ApiService:Skills', `Failed uninstalling skill ${skillId}: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  },

  async testOllamaConnection(host?: string): Promise<{ success: boolean; version?: string; modelsCount?: number; error?: string }> {
    if (!window.electronAPI?.testOllamaConnection) {
      return { success: false, error: translate('services.electronApiUnavailable') }
    }
    try {
      logger.info('ApiService:Ollama', `Testing connection to Ollama host: ${host || 'default'}`)
      return await window.electronAPI.testOllamaConnection(host)
    } catch (err: unknown) {
      logger.error('ApiService:Ollama', `Failed testing connection to Ollama: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  },
}
