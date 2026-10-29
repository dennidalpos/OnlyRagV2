import type { WorkspaceProject } from '../../../shared/types'
import { projectRegistryRepository } from '../infrastructure/filesystem/projectRegistryRepository'

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

  /** Renames display name of an existing project in the registry. */
  async renameProject(projectPath: string, name: string): Promise<WorkspaceProject | null> {
    return projectRegistryRepository.rename(projectPath, name)
  }

  async removeProject(projectPath: string): Promise<boolean> {
    return projectRegistryRepository.remove(projectPath)
  }
}

export const projectRegistryAppService = new ProjectRegistryAppService()
