import fs from 'node:fs'
import path from 'node:path'
import { userDataRoot } from './userDataRoot'
import { CustomHubInput, SkillHubSource } from '../../domain/skills/skillTypes'
import { logger } from '../logging/logger'
import { errorCode, errorMessage } from '../../../../shared/domain/errors/errorMessage'
import { safeAtomicWrite } from './safeAtomicFileWriter'

export const BUILTIN_HUB_SOURCES: SkillHubSource[] = [
  {
    id: 'official-core',
    name: 'OnlyRag Official Core Hub',
    url: 'builtin://official-core',
    type: 'builtin',
    description: 'Raccolta ufficiale verificata di skill core per React 19, FastAPI, LanceDB, TypeScript e AppSec.',
    isBuiltin: true,
    isReadOnly: true,
  },
  {
    id: 'anthropics-skills',
    name: 'Anthropic Official Agent Skills',
    url: 'https://github.com/anthropics/skills',
    type: 'github-repo',
    description: 'Repository ufficiale Anthropic (agentskills.io) con skill standard per PDF, DOCX, PPTX, XLSX, MCP e testing.',
    isBuiltin: true,
    isReadOnly: true,
  },
  {
    id: 'lobehub-skills',
    name: 'LobeHub Skills & Plugins Marketplace',
    url: 'https://chat-plugins.lobehub.com',
    type: 'json-catalog',
    description: 'Marketplace ufficiale LobeHub con oltre 10.000 tool e plugin per web search, automazione, media e finanza.',
    isBuiltin: true,
    isReadOnly: true,
  },
  {
    id: 'skills-sh',
    name: 'Skills.sh Open Agent Directory',
    url: 'https://www.skills.sh/',
    type: 'github-repo',
    description: 'Directory universale open skills.sh con le migliori skill per software engineering (grill-me, code-review, diagnosing-bugs, tdd, to-spec).',
    isBuiltin: true,
    isReadOnly: true,
  },
]

/** Raised when custom_hubs.json exists but cannot be decoded; the original bytes are never touched in that state. */
export class CustomHubStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CustomHubStoreError'
  }
}

function isStoredSource(value: unknown): value is SkillHubSource {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && record.id.length > 0 && typeof record.name === 'string' && typeof record.url === 'string'
}

export class CustomHubRepository {
  private mutationTail: Promise<unknown> = Promise.resolve()

  private getStoragePath(): string {
    const baseDir = userDataRoot()
    return path.join(baseDir, 'custom_hubs.json')
  }

  /** Absent file is an empty valid store; unreadable or invalid content is an error, never an empty list. */
  private async readCustomSources(): Promise<SkillHubSource[]> {
    const filePath = this.getStoragePath()
    let data: string
    try {
      data = await fs.promises.readFile(filePath, 'utf-8')
    } catch (err: unknown) {
      if (errorCode(err) === 'ENOENT') return []
      throw new CustomHubStoreError(`Custom hubs file is unreadable and was left unchanged: ${errorMessage(err)}`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch (err: unknown) {
      throw new CustomHubStoreError(`Custom hubs file is not valid JSON and was left unchanged: ${errorMessage(err)}`)
    }
    if (!Array.isArray(parsed) || !parsed.every(isStoredSource)) {
      throw new CustomHubStoreError('Custom hubs file has an invalid structure and was left unchanged')
    }
    return parsed
  }

  private async writeCustomSources(customOnly: SkillHubSource[]): Promise<void> {
    const filePath = this.getStoragePath()
    const serialized = JSON.stringify(customOnly, null, 2)
    await safeAtomicWrite(filePath, serialized)
    const confirmed = await fs.promises.readFile(filePath, 'utf-8')
    if (confirmed !== serialized) throw new CustomHubStoreError('Custom hubs write could not be confirmed by readback')
  }

  /** Serializes read-modify-write cycles so concurrent mutations cannot lose each other's changes. */
  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationTail.then(operation, operation)
    this.mutationTail = run.catch(() => undefined)
    return run
  }

  async listSources(): Promise<SkillHubSource[]> {
    return [...BUILTIN_HUB_SOURCES, ...(await this.readCustomSources())]
  }

  async addSource(input: CustomHubInput): Promise<SkillHubSource> {
    if (!input.name || !input.url) {
      throw new Error('Hub name and URL are mandatory')
    }

    const trimmedUrl = input.url.trim().toLowerCase()
    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://') && !trimmedUrl.startsWith('builtin://')) {
      throw new Error('Invalid Hub URL: Must start with http://, https://, or builtin://')
    }

    const cleanId = `custom-${input.name.toLowerCase().replace(/[^a-z0-9-_]/g, '-')}-${Date.now().toString(36)}`
    const newSource: SkillHubSource = {
      id: cleanId,
      name: input.name.trim(),
      url: input.url.trim(),
      type: input.type || (input.url.includes('github') ? 'github-repo' : 'json-catalog'),
      description: input.description?.trim() || "Hub personalizzato configurato dall'utente",
      isBuiltin: false,
    }

    return this.mutate(async () => {
      const customOnly = (await this.readCustomSources()).filter((s) => !s.isBuiltin)
      customOnly.push(newSource)
      await this.writeCustomSources(customOnly)
      logger.log('INFO', 'CustomHubRepo', `Added custom hub: ${newSource.name} (${newSource.url})`)
      return newSource
    })
  }

  async removeSource(sourceId: string): Promise<boolean> {
    if (BUILTIN_HUB_SOURCES.some((s) => s.id === sourceId)) {
      throw new Error('Cannot remove built-in hub source')
    }

    return this.mutate(async () => {
      const customOnly = (await this.readCustomSources()).filter((s) => !s.isBuiltin)
      await this.writeCustomSources(customOnly.filter((s) => s.id !== sourceId))
      logger.log('INFO', 'CustomHubRepo', `Removed custom hub: ${sourceId}`)
      return true
    })
  }
}

export const customHubRepository = new CustomHubRepository()
