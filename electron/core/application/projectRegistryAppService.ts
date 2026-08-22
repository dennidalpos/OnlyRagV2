import fs from 'node:fs'
import path from 'node:path'
import type { WorkspaceProject } from '../../../src/types'
import { logger } from '../../diagnostics'
import { projectRegistryRepository } from '../infrastructure/filesystem/projectRegistryRepository'
import { sessionHistoryAppService } from './sessionHistoryAppService'
import { sidecarAppService } from './sidecarAppService'

/**
 * Use cases for the main-process-owned project registry: the durable list of every project
 * the user has opened, independent of any single renderer window's localStorage.
 */
export class ProjectRegistryAppService {
  async listProjects(): Promise<WorkspaceProject[]> {
    return projectRegistryRepository.list()
  }

  /** Explicit "add project" -- creates the entry (or refreshes it) if it doesn't exist yet. */
  async registerProject(projectPath: string, name?: string): Promise<WorkspaceProject> {
    return projectRegistryRepository.upsert(projectPath, name)
  }

  /** Plain "select project" -- bumps recency only, never creates. */
  async touchProject(projectPath: string): Promise<WorkspaceProject | null> {
    return projectRegistryRepository.touch(projectPath)
  }

  async removeProject(projectPath: string): Promise<boolean> {
    // 1. Purge all sessions, runtime states, audit log records, and prompt history for this project
    try {
      await sessionHistoryAppService.clearSessions(projectPath)
    } catch (err: any) {
      logger.log('WARN', 'ProjectRegistryAppService', `Could not clear sessions for ${projectPath}: ${err.message}`)
    }

    // 2. Purge semantic prompt index in LanceDB
    try {
      await sidecarAppService.removePromptHistoryForProject(projectPath)
    } catch (err: any) {
      logger.log('WARN', 'ProjectRegistryAppService', `Could not purge prompt history for ${projectPath}: ${err.message}`)
    }

    // 3. Remove from the global project registry store
    const removed = await projectRegistryRepository.remove(projectPath)

    // 4. Safely clean up the internal .onlyrag folder inside the removed workspace directory,
    // ensuring zero application residue (sessions, tracker, logs) while NEVER touching user repo files.
    if (projectPath && typeof projectPath === 'string') {
      try {
        const onlyragDir = path.join(projectPath, '.onlyrag')
        if (fs.existsSync(onlyragDir)) {
          await fs.promises.rm(onlyragDir, { recursive: true, force: true })
          logger.log('INFO', 'ProjectRegistryAppService', `Purged internal .onlyrag metadata at ${onlyragDir}`)
        }
      } catch (err: any) {
        logger.log('WARN', 'ProjectRegistryAppService', `Could not purge .onlyrag directory: ${err.message}`)
      }
    }

    return removed
  }

  /**
   * One-shot import of the projects the renderer used to persist in localStorage
   * ('onlyrag_workspace_projects'). Existing registry entries always win on conflict.
   */
  async migrateLegacyProjects(rawProjects: unknown): Promise<{ migrated: number }> {
    if (!Array.isArray(rawProjects) || rawProjects.length === 0) return { migrated: 0 }
    const valid = rawProjects.filter(
      (p): p is WorkspaceProject => !!p && typeof p.path === 'string' && p.path && typeof p.name === 'string' && typeof p.addedAt === 'string'
    )
    const migrated = await projectRegistryRepository.mergeLegacy(valid)
    logger.log('INFO', 'ProjectRegistryAppService', `Migrated ${migrated} legacy project(s) from localStorage to the main-process registry.`)
    return { migrated }
  }
}

export const projectRegistryAppService = new ProjectRegistryAppService()
