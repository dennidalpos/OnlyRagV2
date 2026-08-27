import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import yaml from 'js-yaml'
import { app } from 'electron'
import { logger } from '../../../diagnostics'
import { SkillDefinition, SkillMetadata, SkillOriginType } from '../../domain/skills/skillTypes'

export function calculateSkillChecksum(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  return crypto.createHash('sha256').update(normalized, 'utf-8').digest('hex').slice(0, 16)
}

export function parseSkillFrontmatter(rawContent: string): { metadata: SkillMetadata; body: string } {
  if (!rawContent || typeof rawContent !== 'string') {
    return { metadata: { name: 'untitled', description: '' }, body: '' }
  }

  try {
    let data: Record<string, any> = {}
    let body = rawContent.trim()

    const frontmatterMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
    if (frontmatterMatch) {
      const yamlStr = frontmatterMatch[1]
      body = frontmatterMatch[2].trim()
      const loaded = yaml.load(yamlStr)
      if (loaded && typeof loaded === 'object') {
        data = loaded as Record<string, any>
      }
    }

    // Helper to safely parse string array or comma-separated string
    const toStringArray = (val: any): string[] => {
      if (Array.isArray(val)) {
        return val.map((v) => String(v).trim().toLowerCase()).filter(Boolean)
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
      description: data.description ? String(data.description).trim() : '',
      version: data.version ? String(data.version).trim() : undefined,
      author: data.author ? String(data.author).trim() : undefined,
      originHub: (data.originHub || data.origin_hub) ? String(data.originHub || data.origin_hub).trim() : undefined,
      originHubId: (data.originHubId || data.origin_hub_id) ? String(data.originHubId || data.origin_hub_id).trim() : undefined,
      originChecksum: (data.originChecksum || data.origin_checksum) ? String(data.originChecksum || data.origin_checksum).trim() : undefined,
      isModified: data.isModified !== undefined ? Boolean(data.isModified) : (data.is_modified !== undefined ? Boolean(data.is_modified) : undefined),
      requiredModel: (data.requiredModel || data.required_model || data.model) ? String(data.requiredModel || data.required_model || data.model).trim() : undefined,
      triggers: toStringArray(data.triggers),
      tags: toStringArray(data.tags),
    }

    // Deduplicate array fields
    if (metadata.triggers && metadata.triggers.length > 0) {
      metadata.triggers = Array.from(new Set(metadata.triggers))
    }
    if (metadata.tags && metadata.tags.length > 0) {
      metadata.tags = Array.from(new Set(metadata.tags))
    }

    return { metadata, body }
  } catch (err: any) {
    logger.log('WARN', 'SkillRepo', `Failed parsing skill frontmatter with js-yaml: ${err.message}`)
    return {
      metadata: { name: 'custom-skill', description: 'Custom workspace skill' },
      body: rawContent.trim(),
    }
  }
}

export function serializeSkillContent(body: string, metadata: Partial<SkillMetadata>): string {
  const cleanName = (metadata.name || 'custom-skill').trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-')
  const triggersStr = metadata.triggers && metadata.triggers.length > 0
    ? `[${metadata.triggers.map((t) => `"${t}"`).join(', ')}]`
    : `["${cleanName}"]`
  const tagsStr = metadata.tags && metadata.tags.length > 0
    ? `[${metadata.tags.map((t) => `"${t}"`).join(', ')}]`
    : '["coding"]'

  const lines = [
    '---',
    `name: ${cleanName}`,
    `description: "${metadata.description || `Skill guideline for ${cleanName}`}"`,
    `version: "${metadata.version || '1.0.0'}"`,
    `author: "${metadata.author || 'Local'}"`,
    `triggers: ${triggersStr}`,
    `tags: ${tagsStr}`,
  ]

  if (metadata.originHub) {
    lines.push(`origin_hub: "${metadata.originHub}"`)
  }
  if (metadata.originHubId) {
    lines.push(`origin_hub_id: "${metadata.originHubId}"`)
  }
  if (metadata.originChecksum) {
    lines.push(`origin_checksum: "${metadata.originChecksum}"`)
  }
  if (metadata.isModified !== undefined) {
    lines.push(`is_modified: ${metadata.isModified}`)
  }
  if (metadata.requiredModel) {
    lines.push(`required_model: "${metadata.requiredModel}"`)
  }

  lines.push('---', '', body.trim(), '')
  return lines.join('\n')
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
    const baseDir = app && typeof app.getPath === 'function'
      ? app.getPath('userData')
      : path.join(process.cwd(), 'userdata_dev')
    return path.join(baseDir, 'active_skills.json')
  }

  private loadActiveSkills() {
    if (this.isLoaded) return
    try {
      const p = this.getStateFilePath()
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8')
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          this.activeSkillIds = new Set(parsed.map((s) => String(s).toLowerCase()))
        }
      }
    } catch (err: any) {
      logger.log('WARN', 'SkillRepo', `Failed loading active skills state: ${err.message}`)
    } finally {
      this.isLoaded = true
    }
  }

  private persistActiveSkills() {
    try {
      const p = this.getStateFilePath()
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, JSON.stringify(Array.from(this.activeSkillIds), null, 2), 'utf-8')
    } catch (err: any) {
      logger.log('WARN', 'SkillRepo', `Failed persisting active skills state: ${err.message}`)
    }
  }

  setSkillActive(skillId: string, isActive: boolean) {
    this.loadActiveSkills()
    const normalized = skillId.toLowerCase()
    if (isActive) this.activeSkillIds.add(normalized)
    else this.activeSkillIds.delete(normalized)
    this.persistActiveSkills()
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
    const globalSkillsDir = app && typeof app.getPath === 'function'
      ? path.join(app.getPath('userData'), 'skills')
      : path.join(process.cwd(), 'skills')

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
                content: body || rawContent,
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
              }

              // Overwrite or set by normalized ID
              skillsMap.set(id.toLowerCase(), skillDef)
            } catch (readErr: any) {
              logger.log('WARN', 'SkillRepo', `Error reading skill file ${skillFilePath}: ${readErr.message}`)
            }
          }
        }
      } catch (dirErr: any) {
        logger.log('WARN', 'SkillRepo', `Failed scanning skills directory ${dir}: ${dirErr.message}`)
      }
    }

    return Array.from(skillsMap.values())
  }

  async saveSkill(
    name: string,
    content: string,
    workspaceRoot?: string | null,
    metadata?: Partial<SkillMetadata>
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

    const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-')
    const baseDir = workspaceRoot !== undefined && workspaceRoot !== null
      ? path.join(workspaceRoot, 'skills', cleanName)
      : path.join((app && typeof app.getPath === 'function') ? app.getPath('userData') : process.cwd(), 'skills', cleanName)

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
      await fs.promises.writeFile(targetFile, finalSerialized, 'utf-8')
      logger.log('INFO', 'SkillRepo', `Saved skill '${cleanName}' to ${targetFile}`)
      return { success: true, filePath: targetFile }
    } catch (err: any) {
      logger.log('ERROR', 'SkillRepo', `Failed saving skill ${cleanName}: ${err.message}`)
      return { success: false, error: err.message }
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
    } catch (err: any) {
      logger.log('ERROR', 'SkillRepo', `Error deleting skill ${skillId}: ${err.message}`)
      return { success: false, error: err.message }
    }
  }
}

export const skillRepository = new SkillRepository()
