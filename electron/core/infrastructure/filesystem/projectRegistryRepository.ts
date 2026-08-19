import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { logger } from '../../../diagnostics'
import type { WorkspaceProject } from '../../../../src/types'
import { upsertProject, touchProject, sortProjectsByRecency, mergeProjects } from '../../domain/workspace/projectRegistryDomain'

const REGISTRY_FILE_NAME = 'project_registry.json'
const STORE_VERSION = 1

interface ProjectRegistryStore {
  version: number
  projects: WorkspaceProject[]
}

/**
 * Single global (non-workspace-scoped) filesystem store for every project the user has ever
 * opened, so the main process -- not just the renderer's localStorage -- knows the full set
 * of known projects. Lives under Electron's userData dir, same root as skillRepository.ts.
 */
export class ProjectRegistryRepository {
  private readonly stateFilePath?: string

  constructor(customStateDir?: string) {
    if (customStateDir) {
      this.stateFilePath = path.join(customStateDir, REGISTRY_FILE_NAME)
    }
  }

  private getStateFilePath(): string {
    if (this.stateFilePath) return this.stateFilePath
    const baseDir = app && typeof app.getPath === 'function' ? app.getPath('userData') : path.join(process.cwd(), 'userdata_dev')
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
    } catch (err: any) {
      logger.log('WARN', 'ProjectRegistryRepo', `Failed reading project registry at ${filePath}: ${err.message}`)
      return []
    }
  }

  private async writeStore(projects: WorkspaceProject[]): Promise<boolean> {
    const filePath = this.getStateFilePath()
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      const payload: ProjectRegistryStore = { version: STORE_VERSION, projects }
      const tempPath = `${filePath}.tmp`
      await fs.promises.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf-8')
      await fs.promises.rename(tempPath, filePath)
      return true
    } catch (err: any) {
      logger.log('WARN', 'ProjectRegistryRepo', `Failed writing project registry at ${filePath}: ${err.message}`)
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

  public async remove(projectPath: string): Promise<boolean> {
    const projects = await this.readStore()
    const remaining = projects.filter((p) => p.path !== projectPath)
    if (remaining.length === projects.length) return false
    return this.writeStore(remaining)
  }

  /** Merges legacy localStorage projects in, keeping the registry's own entries on conflict. */
  public async mergeLegacy(incoming: WorkspaceProject[]): Promise<number> {
    const existing = await this.readStore()
    const merged = mergeProjects(existing, incoming)
    if (merged.length === existing.length) return 0
    const saved = await this.writeStore(merged)
    return saved ? merged.length - existing.length : 0
  }
}

export const projectRegistryRepository = new ProjectRegistryRepository()
