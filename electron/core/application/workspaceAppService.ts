import { documentIoRepository } from '../infrastructure/filesystem/documentIoRepository'
import type { RendererEventSink } from '../domain/ports/rendererEventSink'
import { allWindowsEventSink } from '../infrastructure/electron/rendererEventSinks'
import { FileSystemRepository } from '../infrastructure/filesystem/fileSystemRepository'
import { taskRunner } from '../infrastructure/process/taskRunner'
import { webClient } from '../infrastructure/http/webClient'
import { gitCliRepository } from '../infrastructure/process/gitCliRepository'
import type { GuestOsInfo } from '../domain/workspace/workspaceTypes'
import { appSettingsRepository } from '../infrastructure/filesystem/appSettingsRepository'
import { authorizeOfflineStrict } from '../domain/agent/offlineStrictPolicy'
import { authorizeLocalOnly } from '../domain/agent/localOnlyPolicy'
import { contentVersion } from '../infrastructure/filesystem/fileContentVersion'
import { validateWorkspaceRealpath } from '../infrastructure/filesystem/workspaceRealpathGuard'
import { standaloneScratchWorkspace } from '../infrastructure/filesystem/standaloneScratchWorkspace'
import { sessionHistoryRepository } from '../infrastructure/filesystem/sessionHistoryRepository'

export class WorkspaceAppService {
  private repo = new FileSystemRepository()

  constructor(private readonly rendererEvents: RendererEventSink = allWindowsEventSink) {}

  listFiles(targetPath?: string) {
    if (!targetPath) return Promise.resolve([])
    return this.repo.listFiles(targetPath)
  }

  async getStandaloneScratchWorkspace() {
    const scratchPath = standaloneScratchWorkspace.getPath()
    await sessionHistoryRepository.migrateStandaloneSessions(scratchPath)
    return { path: scratchPath }
  }

  exportStandaloneScratchWorkspace(destinationDirectory: string) {
    return standaloneScratchWorkspace.exportTo(destinationDirectory)
  }

  clearStandaloneScratchWorkspace() {
    return standaloneScratchWorkspace.clear()
  }

  readFile(filePath: string, startLine?: number, endLine?: number) {
    return this.repo.readFile(filePath, startLine, endLine)
  }

  writeFile(filePath: string, content: string, expectedContentHash?: string, workspaceRoot?: string) {
    const pathCheck = workspaceRoot ? validateWorkspaceRealpath(filePath, workspaceRoot) : { safePath: filePath }
    if (!pathCheck.safePath) return { success: false, error: pathCheck.error }
    const result = this.repo.writeFileVersioned(pathCheck.safePath, content, expectedContentHash, () => {})
    return result.success ? { ...result, contentHash: contentVersion(content) } : result
  }

  /** Used by the agent's delete_file tool; open editors purge references to the deleted path. */
  async deleteFile(filePath: string) {
    const res = await this.repo.deleteFile(filePath)
    if (res.success) this.rendererEvents.send('workspace:file-deleted', { filePath })
    return res
  }

  replaceChunk(filePath: string, targetContent: string, replacementContent: string) {
    return this.repo.replaceChunk(filePath, targetContent, replacementContent)
  }

  grepSearch(dirPath: string, query: string, isRegex?: boolean, caseInsensitive?: boolean) {
    return this.repo.grepSearch(dirPath, query, isRegex, caseInsensitive)
  }

  async searchWeb(query: string, maxResults?: number) {
    const policyError = await this.networkPolicyError('web_search', 'connect', query)
    if (policyError) {
      return { success: false, results: [], error: policyError }
    }
    return webClient.searchWeb(query, maxResults)
  }

  async fetchWebContent(url: string, maxChars?: number) {
    const policyError = await this.networkPolicyError('fetch_web_content', 'connect', url)
    if (policyError) {
      return { success: false, error: policyError }
    }
    return webClient.fetchWebContent(url, maxChars)
  }

  async downloadFile(url: string, targetFilePath: string, workspaceRoot?: string) {
    const policyError = await this.networkPolicyError('download_file', 'download', url, workspaceRoot)
    if (policyError) {
      return { success: false, error: policyError }
    }
    return webClient.downloadFile(url, targetFilePath, workspaceRoot)
  }

  private async networkPolicyError(toolName: string, operation: 'connect' | 'download', target: string, workspaceRoot?: string): Promise<string | null> {
    const settings = await appSettingsRepository.loadSettings()
    const mode = settings?.capabilityPolicyMode
    if (!mode || !['offline-strict', 'local-only'].includes(mode)) return null
    const request = {
      sessionId: 'workspace-ipc',
      toolName,
      capability: 'http-download',
      operation,
      mode,
      workspaceRoot: workspaceRoot || process.cwd(),
      target,
      consent: { requested: false, granted: false },
    } as const
    const policy = mode === 'local-only' ? authorizeLocalOnly(request) : authorizeOfflineStrict(request)
    return policy.allowed ? null : policy.reason
  }

  async inspectGuestOsEnvironment(): Promise<GuestOsInfo> {
    const os = await import('node:os')
    const [hasGit, hasNode, hasNpm, hasPython, hasOllama] = await Promise.all([
      taskRunner.checkToolAvailable('git'),
      taskRunner.checkToolAvailable('node'),
      taskRunner.checkToolAvailable('npm'),
      taskRunner.checkToolAvailable('python'),
      taskRunner.checkToolAvailable('ollama'),
    ])

    const cpuList = os.cpus() || []
    const totalBytes = os.totalmem()
    const freeBytes = os.freemem()
    const totalGB = Number((totalBytes / (1024 * 1024 * 1024)).toFixed(1))
    const freeGB = Number((freeBytes / (1024 * 1024 * 1024)).toFixed(1))

    return {
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      hostname: os.hostname(),
      cpuCount: cpuList.length,
      cpuModel: cpuList[0]?.model || '',
      totalMemoryGB: totalGB,
      freeMemoryGB: freeGB,
      nodeVersion: process.version,
      electronVersion: process.versions.electron || '',
      tools: {
        git: hasGit,
        node: hasNode,
        npm: hasNpm,
        python: hasPython,
        ollama: hasOllama,
      },
      cpus: cpuList.length,
      totalMemMb: Math.round(totalBytes / (1024 * 1024)),
      freeMemMb: Math.round(freeBytes / (1024 * 1024)),
      hasGit,
      hasNode,
      hasNpm,
      hasPython,
      hasOllama,
    }
  }

  executePowerShellCommand(command: string, targetCwd?: string, timeoutMs?: number) {
    return taskRunner.executePowerShellCommand(command, targetCwd, timeoutMs)
  }

  getGitStatusAndDiff(workspacePath?: string | null) {
    const cwd = workspacePath && documentIoRepository.exists(workspacePath) ? workspacePath : process.cwd()
    return gitCliRepository.getStatusAndDiff(cwd)
  }

  initGitRepository(workspacePath?: string | null) {
    if (!workspacePath || !documentIoRepository.exists(workspacePath)) {
      return { success: false, message: 'Invalid or missing workspace path' }
    }
    return gitCliRepository.init(workspacePath)
  }
}

export const workspaceAppService = new WorkspaceAppService()
