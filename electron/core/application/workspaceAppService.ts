import fs from 'node:fs'
import { FileSystemRepository } from '../infrastructure/filesystem/fileSystemRepository'
import { taskRunner } from '../infrastructure/process/taskRunner'
import { webClient } from '../infrastructure/http/webClient'
import { gitCliRepository } from '../infrastructure/process/gitCliRepository'
import type { GuestOsInfo } from '../domain/workspace/workspaceTypes'

export class WorkspaceAppService {
  private repo = new FileSystemRepository()

  listFiles(targetPath?: string) {
    if (!targetPath) return Promise.resolve([])
    return this.repo.listFiles(targetPath)
  }

  getProjectMap(dirPath: string) {
    if (!dirPath) return Promise.resolve([])
    return this.repo.getProjectMap(dirPath)
  }

  readFile(filePath: string, startLine?: number, endLine?: number) {
    return this.repo.readFile(filePath, startLine, endLine)
  }

  writeFile(filePath: string, content: string) {
    return this.repo.writeFile(filePath, content)
  }

  async deleteFile(filePath: string) {
    const res = await this.repo.deleteFile(filePath)
    if (res.success) {
      try {
        const { BrowserWindow } = await import('electron')
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send('workspace:file-deleted', { filePath })
          }
        })
      } catch (broadcastErr: any) {
        // Ignore window broadcast failure during headless testing
      }
    }
    return res
  }

  replaceChunk(filePath: string, targetContent: string, replacementContent: string) {
    return this.repo.replaceChunk(filePath, targetContent, replacementContent)
  }

  multiReplaceChunks(filePath: string, replacements: { targetContent: string; replacementContent: string }[]) {
    return this.repo.multiReplaceChunks(filePath, replacements)
  }

  grepSearch(dirPath: string, query: string, isRegex?: boolean, caseInsensitive?: boolean) {
    return this.repo.grepSearch(dirPath, query, isRegex, caseInsensitive)
  }

  searchWeb(query: string, maxResults?: number) {
    return webClient.searchWeb(query, maxResults)
  }

  fetchWebContent(url: string, maxChars?: number) {
    return webClient.fetchWebContent(url, maxChars)
  }

  downloadFile(url: string, targetFilePath: string, workspaceRoot?: string) {
    return webClient.downloadFile(url, targetFilePath, workspaceRoot)
  }

  gitCommit(workspaceRoot: string | undefined, commitMessage: string) {
    const cwd = workspaceRoot || process.cwd()
    const trimmedMessage = (commitMessage || '').trim()
    if (!trimmedMessage) {
      return { success: false, output: 'Git Commit Error: commitMessage parameter is required.', error: 'Git Commit Error: commitMessage parameter is required.' }
    }
    try {
      const stdout = gitCliRepository.commit(cwd, trimmedMessage)
      return {
        success: true,
        output: `[GIT COMMIT: ${cwd}]\n${stdout.trim()}\n[END GIT COMMIT]`,
      }
    } catch (err: any) {
      const detail = (err.stdout?.toString().trim() || err.stderr?.toString().trim() || err.message) as string
      return { success: false, output: `Git Commit Error: ${detail}`, error: `Git Commit Error: ${detail}` }
    }
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
    const cwd = workspacePath && fs.existsSync(workspacePath) ? workspacePath : process.cwd()
    return gitCliRepository.getStatusAndDiff(cwd)
  }

  initGitRepository(workspacePath?: string | null) {
    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return { success: false, message: 'Invalid or missing workspace path' }
    }
    return gitCliRepository.init(workspacePath)
  }
}

export const workspaceAppService = new WorkspaceAppService()
