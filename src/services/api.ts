import {
  DiagnosticsData,
  LogEntry,
  IngestedDocument,
  VectorSearchResult,
  WorkspaceFile,
  SkillDefinition,
  HubSkillItem,
  SkillHubSource,
  CustomHubInput,
  SkillSaveInput,
} from '../types'
import { logger } from '../lib/logger'

/**
 * Centralized Type-Safe API Service Abstraction for OnlyRag V2
 * Provides safe wrappers around Electron IPC API with automated telemetry logging.
 */
export const apiService = {
  async runDiagnostics(): Promise<DiagnosticsData | null> {
    if (!window.electronAPI) return null
    try {
      return await window.electronAPI.runDiagnostics()
    } catch (err: any) {
      logger.error('ApiService:Diagnostics', `Failed to run system diagnostics: ${err.message}`)
      return null
    }
  },

  async getLogs(): Promise<LogEntry[]> {
    if (!window.electronAPI) return []
    try {
      return await window.electronAPI.getLogs()
    } catch (err: any) {
      logger.error('ApiService:Logs', `Failed to fetch logs: ${err.message}`)
      return []
    }
  },

  async clearLogs(): Promise<boolean> {
    if (!window.electronAPI) return false
    try {
      return await window.electronAPI.clearLogs()
    } catch (err: any) {
      logger.error('ApiService:Logs', `Failed to clear logs: ${err.message}`)
      return false
    }
  },

  async openLogsFolder(): Promise<{ success: boolean; path?: string; error?: string }> {
    if (!window.electronAPI?.openLogsFolder) return { success: false, error: 'Electron API unavailable' }
    try {
      return await window.electronAPI.openLogsFolder()
    } catch (err: any) {
      logger.error('ApiService:Logs', `Failed to open logs folder: ${err.message}`)
      return { success: false, error: err.message }
    }
  },

  async getIngestedDocuments(): Promise<IngestedDocument[]> {
    if (!window.electronAPI) return []
    try {
      return await window.electronAPI.getIngestedDocuments()
    } catch (err: any) {
      logger.error('ApiService:Ingestion', `Failed to fetch ingested documents: ${err.message}`)
      return []
    }
  },

  async ingestFile(
    filePath: string,
    visionModel?: string,
    visionPrompt?: string,
    normalizeWithLlm?: boolean,
    normalizationModel?: string
  ): Promise<{ success: boolean; data?: IngestedDocument; error?: string }> {
    if (!window.electronAPI) return { success: false, error: 'Electron API unavailable' }
    try {
      logger.info('ApiService:Ingestion', `Initiating ingestion for file: ${filePath} (normalizeWithLlm=${normalizeWithLlm}, normalizationModel=${normalizationModel})`)
      const res = await window.electronAPI.ingestFile(filePath, visionModel, visionPrompt, normalizeWithLlm, normalizationModel)
      if (!res.success) {
        logger.warn('ApiService:Ingestion', `Ingestion warning/error: ${res.error}`)
      } else {
        window.dispatchEvent(new CustomEvent('onlyrag:documents-changed'))
      }
      return res
    } catch (err: any) {
      logger.error('ApiService:Ingestion', `Exception during file ingestion: ${err.message}`)
      return { success: false, error: err.message }
    }
  },

  async updateIngestedDocument(docId: string, markdownContent: string): Promise<{ success: boolean; data?: IngestedDocument; error?: string }> {
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
    } catch (err: any) {
      logger.error('ApiService:Ingestion', `Exception updating document ${docId}: ${err.message}`)
      return { success: false, error: err.message }
    }
  },

  async translateDocumentInplace(docId: string, sourceLang: string, targetLang: string, model?: string, backupOriginal: boolean = true, targetDir?: string): Promise<{ success: boolean; data?: IngestedDocument; error?: string }> {
    if (!window.electronAPI) return { success: false, error: 'Electron API unavailable' }
    try {
      logger.info('ApiService:Ingestion', `Translating document in place ${docId} (${sourceLang} -> ${targetLang})`)
      const res = await window.electronAPI.translateDocumentInplace(docId, sourceLang, targetLang, model, backupOriginal, targetDir)
      if (!res.success) {
        logger.warn('ApiService:Ingestion', `Translate in-place warning/error: ${res.error}`)
      } else {
        window.dispatchEvent(new CustomEvent('onlyrag:documents-changed'))
      }
      return res
    } catch (err: any) {
      logger.error('ApiService:Ingestion', `Exception translating document ${docId} in place: ${err.message}`)
      return { success: false, error: err.message }
    }
  },

  async getDocumentPagePreview(docId: string, pageNumber: number) {
    if (!window.electronAPI?.getDocumentPagePreview) return null
    try {
      return await window.electronAPI.getDocumentPagePreview(docId, pageNumber)
    } catch (err: any) {
      logger.warn('ApiService:Ingestion', `Failed getting page preview for ${docId}, p.${pageNumber}: ${err.message}`)
      return null
    }
  },

  async deleteIngestedDocument(docId: string): Promise<boolean> {
    if (!window.electronAPI) return false
    try {
      logger.info('ApiService:Ingestion', `Deleting document ${docId} from LanceDB`)
      const res = await window.electronAPI.deleteIngestedDocument(docId)
      if (res.success) {
        window.dispatchEvent(new CustomEvent('onlyrag:documents-changed'))
      }
      return res.success
    } catch (err: any) {
      logger.error('ApiService:Ingestion', `Failed deleting document ${docId}: ${err.message}`)
      return false
    }
  },

  async searchVectorDb(query: string, topK: number = 5, embeddingModel?: string, docIds?: string[]): Promise<VectorSearchResult[]> {
    if (!window.electronAPI) return []
    try {
      return await window.electronAPI.searchVectorDb(query, topK, embeddingModel, docIds)
    } catch (err: any) {
      logger.error('ApiService:Search', `Vector search query failed: ${err.message}`)
      return []
    }
  },

  async exportDocument(markdownContent: string, format: string, outputFolder?: string): Promise<{ success: boolean; message?: string; error?: string }> {
    if (!window.electronAPI) return { success: false, error: 'Electron API unavailable' }
    try {
      return await window.electronAPI.exportDocument(markdownContent, format, outputFolder)
    } catch (err: any) {
      logger.error('ApiService:Export', `Export failed for format ${format}: ${err.message}`)
      return { success: false, error: err.message }
    }
  },

  async listWorkspaceFiles(dirPath?: string): Promise<WorkspaceFile[]> {
    if (!window.electronAPI) return []
    try {
      return await window.electronAPI.listWorkspaceFiles(dirPath)
    } catch (err: any) {
      logger.error('ApiService:Workspace', `Failed listing files for ${dirPath || 'root'}: ${err.message}`)
      return []
    }
  },

  async readWorkspaceFile(filePath: string): Promise<{ success: boolean; content?: string; error?: string }> {
    if (!window.electronAPI) return { success: false, error: 'Electron API unavailable' }
    try {
      return await window.electronAPI.readWorkspaceFile(filePath)
    } catch (err: any) {
      logger.error('ApiService:Workspace', `Failed reading file ${filePath}: ${err.message}`)
      return { success: false, error: err.message }
    }
  },

  async writeWorkspaceFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }> {
    if (!window.electronAPI) return { success: false, error: 'Electron API unavailable' }
    try {
      logger.info('ApiService:Workspace', `Writing file content to ${filePath}`)
      return await window.electronAPI.writeWorkspaceFile(filePath, content)
    } catch (err: any) {
      logger.error('ApiService:Workspace', `Failed writing file ${filePath}: ${err.message}`)
      return { success: false, error: err.message }
    }
  },

  async executePowerShellCommand(command: string, cwd?: string): Promise<{ success: boolean; output: string; error?: string }> {
    if (!window.electronAPI) return { success: false, output: '', error: 'Electron API unavailable' }
    try {
      logger.info('ApiService:PowerShell', `Executing command: ${command} in ${cwd || 'default'}`)
      return await window.electronAPI.executePowerShellCommand(command, cwd)
    } catch (err: any) {
      logger.error('ApiService:PowerShell', `PowerShell command execution error: ${err.message}`)
      return { success: false, output: '', error: err.message }
    }
  },

  async replaceWorkspaceFileChunk(filePath: string, targetContent: string, replacementContent: string): Promise<{ success: boolean; error?: string }> {
    if (!window.electronAPI) return { success: false, error: 'Electron API unavailable' }
    try {
      logger.info('ApiService:Workspace', `Replacing chunk in file: ${filePath}`)
      return await window.electronAPI.replaceWorkspaceFileChunk(filePath, targetContent, replacementContent)
    } catch (err: any) {
      logger.error('ApiService:Workspace', `Failed replacing chunk in ${filePath}: ${err.message}`)
      return { success: false, error: err.message }
    }
  },

  async grepWorkspaceFiles(dirPath: string, query: string, isRegex?: boolean, caseInsensitive?: boolean) {
    if (!window.electronAPI) return []
    try {
      return await window.electronAPI.grepWorkspaceFiles(dirPath, query, isRegex, caseInsensitive)
    } catch (err: any) {
      logger.error('ApiService:Grep', `Grep search error: ${err.message}`)
      return []
    }
  },

  async inspectGuestOsEnvironment() {
    if (!window.electronAPI) return null
    try {
      return await window.electronAPI.inspectGuestOsEnvironment()
    } catch (err: any) {
      logger.error('ApiService:GuestOs', `Failed inspecting guest OS: ${err.message}`)
      return null
    }
  },

  async parseAgentToolCall(rawText: string) {
    if (!window.electronAPI) return null
    try {
      return await window.electronAPI.parseAgentToolCall(rawText)
    } catch (err: any) {
      logger.warn('ApiService:ToolParser', `IPC Tool Call Parse error: ${err.message}`)
      return null
    }
  },

  async openFileDialog(options?: { title?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string[]> {
    if (!window.electronAPI?.openFileDialog) return []
    try {
      return await window.electronAPI.openFileDialog(options)
    } catch (err: any) {
      logger.error('ApiService:Dialog', `Open file dialog error: ${err.message}`)
      return []
    }
  },

  async openDirectoryDialog(options?: { title?: string }): Promise<string | null> {
    if (!window.electronAPI?.openDirectoryDialog) return null
    try {
      return await window.electronAPI.openDirectoryDialog(options)
    } catch (err: any) {
      logger.error('ApiService:Dialog', `Open directory dialog error: ${err.message}`)
      return null
    }
  },

  async searchWeb(query: string, maxResults?: number) {
    if (!window.electronAPI?.searchWeb) return { success: false, results: [], error: 'Electron API unavailable' }
    try {
      logger.info('ApiService:Web', `Initiating web search for "${query}"`)
      return await window.electronAPI.searchWeb(query, maxResults)
    } catch (err: any) {
      logger.error('ApiService:Web', `Web search failed for "${query}": ${err.message}`)
      return { success: false, results: [], error: err.message }
    }
  },

  async fetchWebContent(url: string, maxChars?: number) {
    if (!window.electronAPI?.fetchWebContent) return { success: false, error: 'Electron API unavailable' }
    try {
      logger.info('ApiService:Web', `Fetching web content from "${url}"`)
      return await window.electronAPI.fetchWebContent(url, maxChars)
    } catch (err: any) {
      logger.error('ApiService:Web', `Fetch web content failed for "${url}": ${err.message}`)
      return { success: false, error: err.message }
    }
  },

  async downloadFile(url: string, targetFilePath: string) {
    if (!window.electronAPI?.downloadFile) return { success: false, error: 'Electron API unavailable' }
    try {
      logger.info('ApiService:Web', `Downloading file from "${url}" to "${targetFilePath}"`)
      return await window.electronAPI.downloadFile(url, targetFilePath)
    } catch (err: any) {
      logger.error('ApiService:Web', `Download file failed for "${url}": ${err.message}`)
      return { success: false, error: err.message }
    }
  },

  async listInstalledSkills(workspaceRoot?: string): Promise<SkillDefinition[]> {
    if (!window.electronAPI?.listInstalledSkills) return []
    try {
      return await window.electronAPI.listInstalledSkills(workspaceRoot)
    } catch (err: any) {
      logger.error('ApiService:Skills', `Failed listing installed skills: ${err.message}`)
      return []
    }
  },

  async listHubSources(): Promise<SkillHubSource[]> {
    if (!window.electronAPI?.listHubSources) return []
    try {
      return await window.electronAPI.listHubSources()
    } catch (err: any) {
      logger.error('ApiService:Skills', `Failed listing hub sources: ${err.message}`)
      return []
    }
  },

  async addCustomHubSource(input: CustomHubInput): Promise<{ success: boolean; source?: SkillHubSource; error?: string }> {
    if (!window.electronAPI?.addCustomHubSource) return { success: false, error: 'Electron API unavailable' }
    try {
      return await window.electronAPI.addCustomHubSource(input)
    } catch (err: any) {
      logger.error('ApiService:Skills', `Failed adding custom hub: ${err.message}`)
      return { success: false, error: err.message }
    }
  },

  async removeCustomHubSource(sourceId: string): Promise<{ success: boolean; error?: string }> {
    if (!window.electronAPI?.removeCustomHubSource) return { success: false, error: 'Electron API unavailable' }
    try {
      return await window.electronAPI.removeCustomHubSource(sourceId)
    } catch (err: any) {
      logger.error('ApiService:Skills', `Failed removing custom hub: ${err.message}`)
      return { success: false, error: err.message }
    }
  },

  async listHubSkillsBySource(sourceId: string, workspaceRoot?: string, forceRefresh?: boolean): Promise<HubSkillItem[]> {
    if (!window.electronAPI?.listHubSkillsBySource) return []
    try {
      return await window.electronAPI.listHubSkillsBySource(sourceId, workspaceRoot, forceRefresh)
    } catch (err: any) {
      logger.error('ApiService:Skills', `Failed listing skills for hub ${sourceId}: ${err.message}`)
      return []
    }
  },

  async toggleSkillActive(skillId: string, isActive: boolean): Promise<boolean> {
    if (!window.electronAPI?.toggleSkillActive) return false
    try {
      return await window.electronAPI.toggleSkillActive(skillId, isActive)
    } catch (err: any) {
      logger.error('ApiService:Skills', `Failed toggling skill ${skillId}: ${err.message}`)
      return false
    }
  },

  async installSkillFromHub(hubSkillId: string, workspaceRoot?: string, hubSourceId?: string): Promise<{ success: boolean; skill?: SkillDefinition; error?: string }> {
    if (!window.electronAPI?.installSkillFromHub) return { success: false, error: 'Electron API unavailable' }
    try {
      return await window.electronAPI.installSkillFromHub(hubSkillId, workspaceRoot, hubSourceId)
    } catch (err: any) {
      logger.error('ApiService:Skills', `Failed installing hub skill ${hubSkillId}: ${err.message}`)
      return { success: false, error: err.message }
    }
  },

  async installSkillFromUrl(url: string, workspaceRoot?: string, customName?: string): Promise<{ success: boolean; skill?: SkillDefinition; error?: string }> {
    if (!window.electronAPI?.installSkillFromUrl) return { success: false, error: 'Electron API unavailable' }
    try {
      return await window.electronAPI.installSkillFromUrl(url, workspaceRoot, customName)
    } catch (err: any) {
      logger.error('ApiService:Skills', `Failed installing skill from URL ${url}: ${err.message}`)
      return { success: false, error: err.message }
    }
  },

  async saveCustomSkill(input: SkillSaveInput, workspaceRoot?: string): Promise<{ success: boolean; skill?: SkillDefinition; error?: string }> {
    if (!window.electronAPI?.saveCustomSkill) return { success: false, error: 'Electron API unavailable' }
    try {
      return await window.electronAPI.saveCustomSkill(input, workspaceRoot)
    } catch (err: any) {
      logger.error('ApiService:Skills', `Failed saving custom skill: ${err.message}`)
      return { success: false, error: err.message }
    }
  },

  async resetSkillToOriginal(skillId: string, workspaceRoot?: string): Promise<{ success: boolean; skill?: SkillDefinition; error?: string }> {
    if (!window.electronAPI?.resetSkillToOriginal) return { success: false, error: 'Electron API unavailable' }
    try {
      return await window.electronAPI.resetSkillToOriginal(skillId, workspaceRoot)
    } catch (err: any) {
      logger.error('ApiService:Skills', `Failed resetting skill ${skillId}: ${err.message}`)
      return { success: false, error: err.message }
    }
  },

  async uninstallSkill(skillId: string, workspaceRoot?: string): Promise<{ success: boolean; error?: string }> {
    if (!window.electronAPI?.uninstallSkill) return { success: false, error: 'Electron API unavailable' }
    try {
      return await window.electronAPI.uninstallSkill(skillId, workspaceRoot)
    } catch (err: any) {
      logger.error('ApiService:Skills', `Failed uninstalling skill ${skillId}: ${err.message}`)
      return { success: false, error: err.message }
    }
  },

  async applyOllamaEnvironmentVariables(
    variables: { name: string; value: string }[],
    restartOllama: boolean = false
  ): Promise<{ success: boolean; appliedCount: number; message: string; error?: string }> {
    if (!window.electronAPI?.applyOllamaEnvironmentVariables) {
      return { success: false, appliedCount: 0, message: 'Electron API non disponibile' }
    }
    try {
      logger.info('ApiService:System', `Applying ${variables.length} environment variables (restart=${restartOllama})`)
      return await window.electronAPI.applyOllamaEnvironmentVariables(variables, restartOllama)
    } catch (err: any) {
      logger.error('ApiService:System', `Failed applying environment variables: ${err.message}`)
      return { success: false, appliedCount: 0, message: err.message, error: err.message }
    }
  },
}
