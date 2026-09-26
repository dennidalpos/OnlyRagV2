import fs from 'node:fs'
import path from 'node:path'
import { userDataRoot } from './userDataRoot'
import { logger } from '../logging/logger'
import type { WorkspaceProject } from '../../../../shared/types'
import { upsertProject, touchProject, sortProjectsByRecency, renameProjectInList } from '../../domain/workspace/projectRegistryDomain'
import { safeAtomicWrite } from './safeAtomicFileWriter'
import { errorMessage } from '../../../../shared/domain/errors/errorMessage'

const REGISTRY_FILE_NAME = 'project_registry.json'
const STORE_VERSION = 1

interface ProjectRegistryStore {
  version: number
  projects: WorkspaceProject[]
}

/** Single global (non-workspace-scoped) filesystem store for every project the user has ever opened, so the main process -- not just the renderer's localStorage -- knows the full set of known projects. */
export class ProjectRegistryRepository {
  private readonly stateFilePath?: string

  constructor(customStateDir?: string) {
    if (customStateDir) {
      this.stateFilePath = path.join(customStateDir, REGISTRY_FILE_NAME)
    }
  }

  private getStateFilePath(): string {
    if (this.stateFilePath) return this.stateFilePath
    const baseDir = userDataRoot()
    return path.join(baseDir, REGISTRY_FILE_NAME)
  }

  private async readStore(): Promise<WorkspaceProject[]> {
    const filePath = this.getStateFilePath()
    if (!fs.existsSync(filePath)) return []
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw) as ProjectRegistryStore
      if (!parsed || !Array.isArray(parsed.projects)) return []
      return parsed.projects.filter((p) => p && typeof p.path === 'string' && p.path && typeof p.name === 'string')
    } catch (err: unknown) {
      logger.log('WARN', 'ProjectRegistryRepo', `Failed reading project registry at ${filePath}: ${errorMessage(err)}`)
      return []
    }
  }

  private async writeStore(projects: WorkspaceProject[]): Promise<boolean> {
    const filePath = this.getStateFilePath()
    try {
      const payload: ProjectRegistryStore = { version: STORE_VERSION, projects }
      return await safeAtomicWrite(filePath, JSON.stringify(payload, null, 2))
    } catch (err: unknown) {
      logger.log('WARN', 'ProjectRegistryRepo', `Failed writing project registry at ${filePath}: ${errorMessage(err)}`)
      return false
    }
  }

  public async list(): Promise<WorkspaceProject[]> {
    return sortProjectsByRecency(await this.readStore())
  }

  /** Creates the project if unseen, or preserves `addedAt` and bumps `lastOpenedAt` if known. */
  public async upsert(projectPath: string, name?: string): Promise<WorkspaceProject> {
    const projects = await this.readStore()
    const next = upsertProject(projects, projectPath, name)
    await this.writeStore(next)
    return next.find((p) => p.path === projectPath)!
  }

  /** Bumps `lastOpenedAt` for a known project; returns null without writing if it isn't registered. */
  public async touch(projectPath: string): Promise<WorkspaceProject | null> {
    const projects = await this.readStore()
    const next = touchProject(projects, projectPath)
    if (!next) return null
    await this.writeStore(next)
    return next.find((p) => p.path === projectPath) || null
  }

  public async rename(projectPath: string, name: string): Promise<WorkspaceProject | null> {
    const projects = await this.readStore()
    const next = renameProjectInList(projects, projectPath, name)
    await this.writeStore(next)
    return next.find((p) => p.path === projectPath) || null
  }

  public async remove(projectPath: string): Promise<boolean> {
    const projects = await this.readStore()
    const remaining = projects.filter((p) => p.path !== projectPath)
    if (remaining.length === projects.length) return false
    return this.writeStore(remaining)
  }
}

export const projectRegistryRepository = new ProjectRegistryRepository()
