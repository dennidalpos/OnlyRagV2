import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
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

  const frontmatterRegex = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/
  const match = rawContent.match(frontmatterRegex)

  if (!match) {
    return {
      metadata: { name: 'custom-skill', description: 'Custom workspace skill' },
      body: rawContent.trim(),
    }
  }

  const rawYaml = match[1]
  const body = (match[2] || '').trim()
  const metadata: SkillMetadata = {
    name: 'custom-skill',
    description: '',
    triggers: [],
    tags: [],
  }

  const lines = rawYaml.split(/\r?\n/)
  for (const line of lines) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue

    const key = line.slice(0, colonIdx).trim().toLowerCase().replace(/[-_]/g, '')
    const val = line.slice(colonIdx + 1).trim()
    const cleanVal = val.replace(/^['"]|['"]$/g, '')

    if (key === 'name') metadata.name = cleanVal
    else if (key === 'description') metadata.description = cleanVal
    else if (key === 'version') metadata.version = cleanVal
    else if (key === 'author') metadata.author = cleanVal
    else if (key === 'originhub') metadata.originHub = cleanVal
    else if (key === 'originhubid') metadata.originHubId = cleanVal
    else if (key === 'originchecksum') metadata.originChecksum = cleanVal
    else if (key === 'ismodified') metadata.isModified = cleanVal.toLowerCase() === 'true'
    else if (key === 'triggers') {
      metadata.triggers = val
        .replace(/[\[\]'"]/g, '')
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    } else if (key === 'tags') {
      metadata.tags = val
        .replace(/[\[\]'"]/g, '')
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    }
  }

  return { metadata, body }
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

  lines.push('---', '', body.trim(), '')
  return lines.join('\n')
}

export class SkillRepository {
  private activeSkillIds = new Set<string>()

  setSkillActive(skillId: string, isActive: boolean) {
    if (isActive) this.activeSkillIds.add(skillId)
    else this.activeSkillIds.delete(skillId)
  }

  isSkillActive(skillId: string): boolean {
    return this.activeSkillIds.has(skillId)
  }

  async listInstalledSkills(workspaceRoot?: string | null): Promise<SkillDefinition[]> {
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
                isActive: this.activeSkillIds.has(id),
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

    const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-')
    const baseDir = workspaceRoot && fs.existsSync(workspaceRoot)
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
      this.activeSkillIds.delete(skillId)
      logger.log('INFO', 'SkillRepo', `Deleted skill '${skillId}'`)
      return { success: true }
    } catch (err: any) {
      logger.log('ERROR', 'SkillRepo', `Error deleting skill ${skillId}: ${err.message}`)
      return { success: false, error: err.message }
    }
  }
}

export const skillRepository = new SkillRepository()
