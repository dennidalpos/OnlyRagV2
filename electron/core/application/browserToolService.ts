import path from 'node:path'
import type { AgentToolCall } from '../domain/agent/agentTypes'
import { validatePathSafety } from '../domain/agent/contextFilter'
import type { ToolExecutionResult } from '../domain/agent/tools/toolExecutionContracts'

interface BrowserToolDependencies {
  openExternal(url: string): Promise<void>
  openPath(filePath: string): Promise<string>
  exists(filePath: string): boolean
}

/** Application service for safe local artifact and URL previews. */
export class BrowserToolService {
  constructor(private readonly dependencies: BrowserToolDependencies) {}

  async executeOpenInBrowser(
    parameters: AgentToolCall['parameters'],
    workspacePath: string | null | undefined,
  ): Promise<ToolExecutionResult> {
    const filePath = parameters.filePath || parameters.path
    const url = parameters.url
    if (!filePath && !url) {
      return {
        outputForHistory: 'Error: missing "filePath" or "url" parameter to open in browser.',
        logMessage: 'Open in browser: missing parameter',
      }
    }

    try {
      if (url && (/^https?:\/\//i).test(url)) {
        await this.dependencies.openExternal(url)
        return {
          outputForHistory: `Successfully opened URL in default web browser: ${url}`,
          logMessage: `Opened URL in browser: ${url}`,
        }
      }

      if (filePath) {
        const pathCheck = validatePathSafety(filePath, workspacePath)
        if (!pathCheck.safePath) {
          return {
            outputForHistory: `Security Violation: ${pathCheck.error}`,
            logMessage: `Open in Browser Rejected: ${pathCheck.error}`,
          }
        }
        if (!this.dependencies.exists(pathCheck.safePath)) {
          return {
            outputForHistory: `Error: File not found to open: ${filePath}`,
            logMessage: `File not found: ${filePath}`,
          }
        }
        const openError = await this.dependencies.openPath(pathCheck.safePath)
        if (openError) {
          return {
            outputForHistory: `Error opening ${filePath} in default system application: ${openError}`,
            logMessage: `Failed to open ${filePath}: ${openError}`,
          }
        }
        return {
          outputForHistory: `Successfully opened ${filePath} in default web browser / viewer.`,
          logMessage: `Opened ${path.basename(filePath)} in browser`,
        }
      }

      return {
        outputForHistory: 'Error: invalid target for open_in_browser.',
        logMessage: 'Invalid open_in_browser target',
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        outputForHistory: `Error opening in browser: ${message}`,
        logMessage: `Browser open error: ${message}`,
      }
    }
  }
}
