import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { CustomHubInput, SkillHubSource } from '../../domain/skills/skillTypes'
import { logger } from '../../../diagnostics'

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

export class CustomHubRepository {
  private getStoragePath(): string {
    const baseDir = app && typeof app.getPath === 'function'
      ? app.getPath('userData')
      : path.join(process.cwd(), 'userdata_dev')
    return path.join(baseDir, 'custom_hubs.json')
  }

  async listSources(): Promise<SkillHubSource[]> {
    const customSources: SkillHubSource[] = []
    const filePath = this.getStoragePath()

    if (fs.existsSync(filePath)) {
      try {
        const data = await fs.promises.readFile(filePath, 'utf-8')
        const parsed = JSON.parse(data)
        if (Array.isArray(parsed)) {
          customSources.push(...parsed)
        }
      } catch (err: any) {
        logger.log('WARN', 'CustomHubRepo', `Error reading custom hubs file: ${err.message}`)
      }
    }

    return [...BUILTIN_HUB_SOURCES, ...customSources]
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
      description: input.description?.trim() || 'Hub personalizzato configurato dall\'utente',
      isBuiltin: false,
    }

    const current = await this.listSources()
    const customOnly = current.filter((s) => !s.isBuiltin)
    customOnly.push(newSource)

    const filePath = this.getStoragePath()
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    await fs.promises.writeFile(filePath, JSON.stringify(customOnly, null, 2), 'utf-8')
    logger.log('INFO', 'CustomHubRepo', `Added custom hub: ${newSource.name} (${newSource.url})`)

    return newSource
  }

  async removeSource(sourceId: string): Promise<boolean> {
    const current = await this.listSources()
    const isBuiltin = current.some((s) => s.id === sourceId && s.isBuiltin)
    if (isBuiltin) {
      throw new Error('Cannot remove built-in hub source')
    }

    const customOnly = current.filter((s) => !s.isBuiltin && s.id !== sourceId)
    const filePath = this.getStoragePath()
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    await fs.promises.writeFile(filePath, JSON.stringify(customOnly, null, 2), 'utf-8')
    logger.log('INFO', 'CustomHubRepo', `Removed custom hub: ${sourceId}`)

    return true
  }
}

export const customHubRepository = new CustomHubRepository()
