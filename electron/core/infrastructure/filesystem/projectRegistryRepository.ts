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
const mutationQueues = new Map<string, Promise<void>>()

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

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const filePath = path.resolve(this.getStateFilePath())
    const result = (mutationQueues.get(filePath) || Promise.resolve()).then(operation)
    // A failed mutation must reject its caller without blocking the next explicit attempt.
    const settled = result.then(
      () => undefined,
      () => undefined,
    )
    mutationQueues.set(filePath, settled)
    try {
      return await result
    } finally {
      if (mutationQueues.get(filePath) === settled) mutationQueues.delete(filePath)
    }
  }

  private async readStore(): Promise<WorkspaceProject[]> {
    const filePath = this.getStateFilePath()
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw) as ProjectRegistryStore
      if (!parsed || (parsed.version !== undefined && parsed.version !== STORE_VERSION) || !Array.isArray(parsed.projects)) {
        throw new Error('Unsupported project registry envelope')
      }
      if (parsed.projects.some((p) => !p || typeof p.path !== 'string' || !p.path || typeof p.name !== 'string')) {
        throw new Error('Invalid retained project')
      }
      if (new Set(parsed.projects.map((p) => p.path)).size !== parsed.projects.length) throw new Error('Duplicate retained project identities')
      return parsed.projects
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return []
      logger.log('WARN', 'ProjectRegistryRepo', `Failed reading project registry at ${filePath}: ${errorMessage(err)}`)
      throw new Error('Project registry is unreadable; original data is preserved')
    }
  }

  private async writeStore(projects: WorkspaceProject[]): Promise<void> {
    const filePath = this.getStateFilePath()
    try {
      const payload: ProjectRegistryStore = { version: STORE_VERSION, projects }
      if (!(await safeAtomicWrite(filePath, JSON.stringify(payload, null, 2)))) throw new Error('Project registry could not be saved')
    } catch (err: unknown) {
      logger.log('WARN', 'ProjectRegistryRepo', `Failed writing project registry at ${filePath}: ${errorMessage(err)}`)
      throw new Error('Project registry could not be saved')
    }
  }

  public async list(): Promise<WorkspaceProject[]> {
    return this.runExclusive(async () => sortProjectsByRecency(await this.readStore()))
  }

  /** Creates the project if unseen, or preserves `addedAt` and bumps `lastOpenedAt` if known. */
  public async upsert(projectPath: string, name?: string): Promise<WorkspaceProject> {
    return this.runExclusive(async () => {
      const projects = await this.readStore()
      const normalizedPath = projectPath.trim()
      if (!normalizedPath) throw new Error('Project path is required')
      const next = upsertProject(projects, normalizedPath, name)
      await this.writeStore(next)
      return next.find((p) => p.path === normalizedPath)!
    })
  }

  /** Bumps `lastOpenedAt` for a known project; returns null without writing if it isn't registered. */
  public async touch(projectPath: string): Promise<WorkspaceProject | null> {
    return this.runExclusive(async () => {
      const projects = await this.readStore()
      const next = touchProject(projects, projectPath)
      if (!next) return null
      await this.writeStore(next)
      return next.find((p) => p.path === projectPath) || null
    })
  }

  public async rename(projectPath: string, name: string): Promise<WorkspaceProject | null> {
    return this.runExclusive(async () => {
      const projects = await this.readStore()
      const next = renameProjectInList(projects, projectPath, name)
      if (next !== projects) await this.writeStore(next)
      return next.find((p) => p.path === projectPath) || null
    })
  }

  public async remove(projectPath: string): Promise<boolean> {
    return this.runExclusive(async () => {
      const projects = await this.readStore()
      const remaining = projects.filter((p) => p.path !== projectPath)
      if (remaining.length === projects.length) return false
      await this.writeStore(remaining)
      return true
    })
  }
}

export const projectRegistryRepository = new ProjectRegistryRepository()
