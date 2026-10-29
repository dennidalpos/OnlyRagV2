import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import yaml from 'js-yaml'
import { isDeepStrictEqual } from 'node:util'
import { safeAtomicWrite } from './safeAtomicFileWriter'
import { userDataRoot } from './userDataRoot'
import { logger } from '../logging/logger'
import { SkillDefinition, SkillMetadata, SkillOriginType } from '../../domain/skills/skillTypes'
import { errorCode, errorMessage } from '../../../../shared/domain/errors/errorMessage'

export function calculateSkillChecksum(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  return crypto.createHash('sha256').update(normalized, 'utf-8').digest('hex').slice(0, 16)
}

export function parseSkillFrontmatter(rawContent: string): { metadata: SkillMetadata; body: string } {
  if (!rawContent || typeof rawContent !== 'string') {
    return { metadata: { name: 'untitled', description: '' }, body: '' }
  }

  try {
    let data: Record<string, unknown> = {}
    let body = rawContent

    const frontmatterMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
    if (frontmatterMatch) {
      const yamlStr = frontmatterMatch[1]
      body = frontmatterMatch[2]
      const loaded = yaml.load(yamlStr)
      if (loaded && typeof loaded === 'object') {
        data = loaded as Record<string, unknown>
      }
    }

    // Helper to safely parse string array or comma-separated string
    const toStringArray = (val: unknown): string[] => {
      if (Array.isArray(val)) {
        return val.map((v) => String(v))
      }
      if (typeof val === 'string' && val.trim()) {
        return val
          .replace(/[\[\]'"]/g, '')
          .split(',')
          .map((v) => v.trim().toLowerCase())
          .filter(Boolean)
      }
      return []
    }

    const metadata: SkillMetadata = {
      name: data.name ? String(data.name).trim() : 'custom-skill',
      description: data.description !== undefined ? String(data.description) : '',
      version: data.version ? String(data.version) : undefined,
      author: data.author ? String(data.author) : undefined,
      originHub: data.originHub || data.origin_hub ? String(data.originHub || data.origin_hub) : undefined,
      originHubId: data.originHubId || data.origin_hub_id ? String(data.originHubId || data.origin_hub_id) : undefined,
      originChecksum: data.originChecksum || data.origin_checksum ? String(data.originChecksum || data.origin_checksum) : undefined,
      isModified: data.isModified !== undefined ? Boolean(data.isModified) : data.is_modified !== undefined ? Boolean(data.is_modified) : undefined,
      requiredModel: data.requiredModel || data.required_model || data.model ? String(data.requiredModel || data.required_model || data.model) : undefined,
      triggers: toStringArray(data.triggers),
      tags: toStringArray(data.tags),
    }

    return { metadata, body }
  } catch (err: unknown) {
    logger.log('WARN', 'SkillRepo', `Failed parsing skill frontmatter with js-yaml: ${errorMessage(err)}`)
    return {
      metadata: { name: 'custom-skill', description: 'Custom workspace skill' },
      body: rawContent,
    }
  }
}

export function normalizeSkillName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
}

export function serializeSkillContent(body: string, metadata: Partial<SkillMetadata>): string {
  const cleanName = normalizeSkillName(metadata.name || 'custom-skill')
  const savedMetadata: SkillMetadata = {
    name: cleanName,
    description: metadata.description ?? `Skill guideline for ${cleanName}`,
    version: metadata.version || '1.0.0',
    author: metadata.author || 'Local',
    triggers: metadata.triggers ?? [cleanName],
    tags: metadata.tags ?? ['coding'],
    originHub: metadata.originHub || undefined,
    originHubId: metadata.originHubId || undefined,
    originChecksum: metadata.originChecksum || undefined,
    isModified: metadata.isModified,
    requiredModel: metadata.requiredModel || undefined,
  }
  const frontmatter = yaml.dump(
    {
      name: savedMetadata.name,
      description: savedMetadata.description,
      version: savedMetadata.version,
      author: savedMetadata.author,
      triggers: savedMetadata.triggers,
      tags: savedMetadata.tags,
      origin_hub: savedMetadata.originHub,
      origin_hub_id: savedMetadata.originHubId,
      origin_checksum: savedMetadata.originChecksum,
      is_modified: savedMetadata.isModified,
      required_model: savedMetadata.requiredModel,
    },
    { lineWidth: -1, noRefs: true, forceQuotes: true, quotingType: '"' },
  )
  const serialized = `---\n${frontmatter}---\n${body}`
  if (!isDeepStrictEqual(parseSkillFrontmatter(serialized), { metadata: savedMetadata, body })) {
    throw new Error('Skill serialization did not preserve metadata and body')
  }
  return serialized
}

export class SkillRepository {
  private activeSkillIds = new Set<string>()
  private stateFilePath: string | null = null
  private isLoaded = false

  constructor(customStateDir?: string) {
    if (customStateDir) {
      this.stateFilePath = path.join(customStateDir, 'active_skills.json')
    }
  }

  private getStateFilePath(): string {
    if (this.stateFilePath) return this.stateFilePath
    const baseDir = userDataRoot()
    return path.join(baseDir, 'active_skills.json')
  }

  private loadActiveSkills() {
    if (this.isLoaded) return
    try {
      const p = this.getStateFilePath()
      try {
        const raw = fs.readFileSync(p, 'utf-8')
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed) || parsed.some((s) => typeof s !== 'string')) throw new Error('Invalid active skills state')
        this.activeSkillIds = new Set(parsed.map((s: string) => s.toLowerCase()))
      } catch (err: unknown) {
        if (errorCode(err) !== 'ENOENT') throw err
      }
      this.isLoaded = true
    } catch (err: unknown) {
      logger.log('WARN', 'SkillRepo', `Failed loading active skills state: ${errorMessage(err)}`)
      throw err
    }
  }

  private persistActiveSkills(next: Set<string>) {
    const p = this.getStateFilePath()
    const staging = `${p}.tmp-${crypto.randomUUID()}`
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true })
      const serialized = JSON.stringify(Array.from(next), null, 2)
      fs.writeFileSync(staging, serialized, { encoding: 'utf-8', flag: 'wx', flush: true })
      if (fs.readFileSync(staging, 'utf-8') !== serialized) throw new Error('Active skills readback mismatch')
      fs.renameSync(staging, p)
    } catch (err: unknown) {
      logger.log('WARN', 'SkillRepo', `Failed persisting active skills state: ${errorMessage(err)}`)
      throw err
    } finally {
      if (fs.existsSync(staging)) fs.unlinkSync(staging)
    }
  }

  setSkillActive(skillId: string, isActive: boolean) {
    this.loadActiveSkills()
    const normalized = skillId.toLowerCase()
    const next = new Set(this.activeSkillIds)
    if (isActive) next.add(normalized)
    else next.delete(normalized)
    this.persistActiveSkills(next)
    this.activeSkillIds = next
  }

  isSkillActive(skillId: string): boolean {
    this.loadActiveSkills()
    return this.activeSkillIds.has(skillId.toLowerCase())
  }

  async listInstalledSkills(workspaceRoot?: string | null): Promise<SkillDefinition[]> {
    this.loadActiveSkills()
    const skillsMap = new Map<string, SkillDefinition>()
    const scannedDirs: { dir: string; isWorkspace: boolean }[] = []

    // 1. Global skills directory first
    // Headless (tests, live harness) global skills live under userdata_dev like every other user store,
    // never in the repository's own skills/ folder: those are OnlyRag's development rules, and they
    // leaked into user projects' prompts (react19-modern-patterns in the 2026-09-25 live run).
    const globalSkillsDir = path.join(userDataRoot(), 'skills')

    if (fs.existsSync(globalSkillsDir)) {
      scannedDirs.push({ dir: globalSkillsDir, isWorkspace: false })
    }

    // 2. Workspace skills directory second (overrides global)
    if (workspaceRoot && fs.existsSync(workspaceRoot)) {
      const wsSkillsDir = path.join(workspaceRoot, 'skills')
      if (fs.existsSync(wsSkillsDir)) {
        scannedDirs.push({ dir: wsSkillsDir, isWorkspace: true })
      }
    }

    for (const { dir, isWorkspace } of scannedDirs) {
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          let skillFilePath = ''
          let skillName = entry.name

          if (entry.isDirectory()) {
            const nestedSkillFile = path.join(dir, entry.name, 'SKILL.md')
            if (fs.existsSync(nestedSkillFile)) {
              skillFilePath = nestedSkillFile
              skillName = entry.name
            }
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
            skillFilePath = path.join(dir, entry.name)
            skillName = entry.name.replace(/\.md$/i, '')
          }

          if (skillFilePath && fs.existsSync(skillFilePath)) {
            try {
              const rawContent = await fs.promises.readFile(skillFilePath, 'utf-8')
              const { metadata, body } = parseSkillFrontmatter(rawContent)
              const id = metadata.name || skillName
              const currentChecksum = calculateSkillChecksum(body)

              let originType: SkillOriginType = 'local_custom'
              let isModified = false

              if (metadata.originHub) {
                if (metadata.isModified === true || (metadata.originChecksum && metadata.originChecksum !== currentChecksum)) {
                  originType = 'hub_modified'
                  isModified = true
                } else {
                  originType = 'hub_original'
                  isModified = false
                }
              }

              const skillDef: SkillDefinition = {
                id,
                name: metadata.name || skillName,
                description: metadata.description || `Skill definition in ${skillName}`,
                content: body,
                filePath: skillFilePath,
                isActive: this.isSkillActive(id) || this.isSkillActive(skillName),
                isWorkspaceLocal: isWorkspace,
                triggers: metadata.triggers && metadata.triggers.length > 0 ? metadata.triggers : [skillName.toLowerCase()],
                tags: metadata.tags && metadata.tags.length > 0 ? metadata.tags : ['skill'],
                version: metadata.version || '1.0.0',
                author: metadata.author || 'Local',
                originType,
                originHub: metadata.originHub,
                originHubId: metadata.originHubId,
                originChecksum: metadata.originChecksum,
                isModified,
                requiredModel: metadata.requiredModel,
              }

              // Overwrite or set by normalized ID
              skillsMap.set(id.toLowerCase(), skillDef)
            } catch (readErr: unknown) {
              logger.log('WARN', 'SkillRepo', `Error reading skill file ${skillFilePath}: ${errorMessage(readErr)}`)
            }
          }
        }
      } catch (dirErr: unknown) {
        logger.log('WARN', 'SkillRepo', `Failed scanning skills directory ${dir}: ${errorMessage(dirErr)}`)
      }
    }

    return Array.from(skillsMap.values())
  }

  async saveSkill(
    name: string,
    content: string,
    workspaceRoot?: string | null,
    metadata?: Partial<SkillMetadata>,
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    if (!name || typeof name !== 'string' || !name.trim()) {
      return { success: false, error: 'Skill name is empty' }
    }

    // An explicit workspace scope must never silently fall back to the global userData scope:
    // auto-install can otherwise report success while making the skill unavailable to its caller.
    if (workspaceRoot !== undefined && workspaceRoot !== null) {
      if (typeof workspaceRoot !== 'string' || !workspaceRoot.trim() || !fs.existsSync(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) {
        return { success: false, error: 'Workspace scope is invalid or does not exist' }
      }
    }

    const cleanName = normalizeSkillName(name)
    const baseDir =
      workspaceRoot !== undefined && workspaceRoot !== null ? path.join(workspaceRoot, 'skills', cleanName) : path.join(userDataRoot(), 'skills', cleanName)

    try {
      await fs.promises.mkdir(baseDir, { recursive: true })
      const targetFile = path.join(baseDir, 'SKILL.md')

      let bodyToSave = content
      let metaToSave: Partial<SkillMetadata> = { ...metadata, name: cleanName }

      if (content.startsWith('---')) {
        const parsed = parseSkillFrontmatter(content)
        bodyToSave = parsed.body
        metaToSave = { ...parsed.metadata, ...metadata, name: cleanName }
      }

      const finalSerialized = serializeSkillContent(bodyToSave, metaToSave)
      await safeAtomicWrite(targetFile, finalSerialized)
      if ((await fs.promises.readFile(targetFile, 'utf-8')) !== finalSerialized) throw new Error('Saved skill readback mismatch')
      logger.log('INFO', 'SkillRepo', `Saved skill '${cleanName}' to ${targetFile}`)
      return { success: true, filePath: targetFile }
    } catch (err: unknown) {
      logger.log('ERROR', 'SkillRepo', `Failed saving skill ${cleanName}: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  }

  async deleteSkill(skillId: string, workspaceRoot?: string | null): Promise<{ success: boolean; error?: string }> {
    const installed = await this.listInstalledSkills(workspaceRoot)
    const target = installed.find((s) => s.id === skillId || s.name === skillId)

    if (!target) {
      return { success: false, error: `Skill '${skillId}' not found` }
    }

    try {
      const targetDir = path.dirname(target.filePath)
      if (path.basename(targetDir).toLowerCase() === target.name.toLowerCase()) {
        await fs.promises.rm(targetDir, { recursive: true, force: true })
      } else {
        await fs.promises.unlink(target.filePath)
      }
      this.setSkillActive(skillId, false)
      this.setSkillActive(target.name, false)
      logger.log('INFO', 'SkillRepo', `Deleted skill '${skillId}'`)
      return { success: true }
    } catch (err: unknown) {
      logger.log('ERROR', 'SkillRepo', `Error deleting skill ${skillId}: ${errorMessage(err)}`)
      return { success: false, error: errorMessage(err) }
    }
  }
}

export const skillRepository = new SkillRepository()
