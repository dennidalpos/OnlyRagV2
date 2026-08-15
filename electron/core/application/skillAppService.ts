import fs from 'node:fs'
import path from 'node:path'
import { skillRepository, calculateSkillChecksum, parseSkillFrontmatter } from '../infrastructure/filesystem/skillRepository'
import { customHubRepository } from '../infrastructure/filesystem/customHubRepository'
import { skillHubClient } from '../infrastructure/http/skillHubClient'
import { matchSkillsForTask, compileSkillsContextBlock, SkillMatchContext } from '../domain/skills/skillMatcher'
import {
  SkillDefinition,
  HubSkillItem,
  SkillHubSource,
  CustomHubInput,
  SkillSaveInput,
} from '../domain/skills/skillTypes'
import { logger } from '../../diagnostics'

function extractProjectStack(workspacePath?: string | null): string[] {
  if (!workspacePath || !fs.existsSync(workspacePath)) return []
  const stack = new Set<string>()

  try {
    // 1. package.json inspection
    const pkgPath = path.join(workspacePath, 'package.json')
    if (fs.existsSync(pkgPath)) {
      const raw = fs.readFileSync(pkgPath, 'utf-8')
      const pkg = JSON.parse(raw)
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      for (const dep of Object.keys(deps)) {
        const clean = dep.replace(/^@[\w-]+\//, '').toLowerCase()
        stack.add(clean)
        stack.add(dep.toLowerCase())
      }
    }

    // 2. Python requirements / pyproject
    const reqPath = path.join(workspacePath, 'requirements.txt')
    if (fs.existsSync(reqPath)) {
      stack.add('python')
      const lines = fs.readFileSync(reqPath, 'utf-8').split(/\r?\n/)
      for (const l of lines) {
        const pkg = l.split(/[=<>~]/)[0].trim().toLowerCase()
        if (pkg && !pkg.startsWith('#')) stack.add(pkg)
      }
    }

    const pyproj = path.join(workspacePath, 'pyproject.toml')
    if (fs.existsSync(pyproj)) {
      stack.add('python')
    }

    // 3. Rust Cargo.toml
    if (fs.existsSync(path.join(workspacePath, 'Cargo.toml'))) {
      stack.add('rust')
      stack.add('cargo')
    }

    // 4. Go go.mod
    if (fs.existsSync(path.join(workspacePath, 'go.mod'))) {
      stack.add('go')
      stack.add('golang')
    }
  } catch (err: any) {
    logger.log('WARN', 'SkillAppService', `Failed extracting project stack: ${err.message}`)
  }

  return Array.from(stack)
}

export class SkillAppService {
  async listInstalledSkills(workspaceRoot?: string | null): Promise<SkillDefinition[]> {
    return skillRepository.listInstalledSkills(workspaceRoot)
  }

  async listHubSources(): Promise<SkillHubSource[]> {
    return customHubRepository.listSources()
  }

  async addCustomHubSource(input: CustomHubInput): Promise<{ success: boolean; source?: SkillHubSource; error?: string }> {
    try {
      const source = await customHubRepository.addSource(input)
      return { success: true, source }
    } catch (err: any) {
      logger.log('ERROR', 'SkillAppService', `Failed adding custom hub: ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  async removeCustomHubSource(sourceId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const success = await customHubRepository.removeSource(sourceId)
      return { success }
    } catch (err: any) {
      logger.log('ERROR', 'SkillAppService', `Failed removing custom hub: ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  async listHubSkillsBySource(sourceId: string, workspaceRoot?: string | null, forceRefresh = false): Promise<HubSkillItem[]> {
    const sources = await customHubRepository.listSources()
    const source = sources.find((s) => s.id === sourceId) || sources[0]
    if (!source) return []

    const installed = await skillRepository.listInstalledSkills(workspaceRoot)
    const installedNames = new Set(installed.map((s) => s.name.toLowerCase()))

    const skills = await skillHubClient.fetchSkillsFromSource(source, forceRefresh)
    return skills.map((item) => ({
      ...item,
      isInstalled: installedNames.has(item.name.toLowerCase()) || installedNames.has(item.id.toLowerCase()),
    }))
  }

  async listHubSkills(workspaceRoot?: string | null, forceRefresh = false): Promise<HubSkillItem[]> {
    return this.listHubSkillsBySource('official-core', workspaceRoot, forceRefresh)
  }

  toggleSkillActive(skillId: string, isActive: boolean): boolean {
    skillRepository.setSkillActive(skillId, isActive)
    logger.log('INFO', 'SkillAppService', `Toggled skill '${skillId}' active: ${isActive}`)
    return true
  }

  async installFromHub(
    hubSkillId: string,
    workspaceRoot?: string | null,
    hubSourceId?: string
  ): Promise<{ success: boolean; skill?: SkillDefinition; error?: string }> {
    const sources = await customHubRepository.listSources()
    const source = sources.find((s) => s.id === hubSourceId) || sources[0]
    if (!source) return { success: false, error: 'Hub source not found' }

    const skills = await skillHubClient.fetchSkillsFromSource(source)
    const hubItem = skills.find((s) => s.id === hubSkillId || s.name.toLowerCase() === hubSkillId.toLowerCase())

    if (!hubItem) {
      return { success: false, error: `Skill '${hubSkillId}' not found in source '${source.name}'` }
    }

    const contentRes = await skillHubClient.fetchSkillContent(hubItem)
    if (!contentRes.success || !contentRes.content) {
      return { success: false, error: contentRes.error || 'Failed to download skill content' }
    }

    const rawContent = contentRes.content
    const { body } = parseSkillFrontmatter(rawContent)
    const bodyContent = body || rawContent
    const checksum = calculateSkillChecksum(bodyContent)

    const saveRes = await skillRepository.saveSkill(hubItem.name, bodyContent, workspaceRoot, {
      name: hubItem.name,
      description: hubItem.description,
      triggers: hubItem.triggers,
      tags: hubItem.tags,
      version: hubItem.version,
      author: hubItem.author,
      originHub: source.name,
      originHubId: source.id,
      originChecksum: checksum,
      isModified: false,
    })

    if (!saveRes.success) {
      return { success: false, error: saveRes.error }
    }

    skillRepository.setSkillActive(hubItem.name, true)
    const installed = await skillRepository.listInstalledSkills(workspaceRoot)
    const newSkill = installed.find((s) => s.name.toLowerCase() === hubItem.name.toLowerCase())

    return { success: true, skill: newSkill }
  }

  async installFromUrl(
    url: string,
    workspaceRoot?: string | null,
    customName?: string
  ): Promise<{ success: boolean; skill?: SkillDefinition; error?: string }> {
    const fetchRes = await skillHubClient.fetchSkillContent(url)
    if (!fetchRes.success || !fetchRes.content) {
      return { success: false, error: fetchRes.error || 'Failed to fetch skill content' }
    }

    let skillName = customName?.trim() || ''
    if (!skillName) {
      const urlSegments = url.split('/')
      const lastSeg = urlSegments[urlSegments.length - 1] || 'custom-skill'
      skillName = lastSeg.replace(/\.md$/i, '')
      if (skillName.toUpperCase() === 'SKILL' && urlSegments.length > 1) {
        skillName = urlSegments[urlSegments.length - 2] || 'custom-skill'
      }
    }

    const { body, metadata } = parseSkillFrontmatter(fetchRes.content)
    const bodyContent = body || fetchRes.content
    const checksum = calculateSkillChecksum(bodyContent)

    const saveRes = await skillRepository.saveSkill(skillName, bodyContent, workspaceRoot, {
      ...metadata,
      name: skillName,
      originHub: url,
      originChecksum: checksum,
      isModified: false,
    })

    if (!saveRes.success) {
      return { success: false, error: saveRes.error }
    }

    skillRepository.setSkillActive(skillName, true)
    const installed = await skillRepository.listInstalledSkills(workspaceRoot)
    const newSkill = installed.find((s) => s.name.toLowerCase() === skillName.toLowerCase())

    return { success: true, skill: newSkill }
  }

  async createOrUpdateSkill(
    input: SkillSaveInput,
    workspaceRoot?: string | null
  ): Promise<{ success: boolean; skill?: SkillDefinition; error?: string }> {
    const installed = await skillRepository.listInstalledSkills(workspaceRoot)
    const existing = installed.find((s) => s.name.toLowerCase() === input.name.toLowerCase() || s.id === input.name)

    let isModified = input.isModified
    let originHub = input.originHub || existing?.originHub
    let originHubId = input.originHubId || existing?.originHubId
    let originChecksum = input.originChecksum || existing?.originChecksum

    const { body } = parseSkillFrontmatter(input.content)
    const bodyContent = body || input.content

    if (originHub && originChecksum) {
      const newChecksum = calculateSkillChecksum(bodyContent)
      if (newChecksum !== originChecksum) {
        isModified = true
      } else {
        isModified = false
      }
    }

    const saveRes = await skillRepository.saveSkill(input.name, bodyContent, workspaceRoot, {
      description: input.description,
      version: input.version,
      author: input.author,
      triggers: input.triggers,
      tags: input.tags,
      originHub,
      originHubId,
      originChecksum,
      isModified,
    })

    if (!saveRes.success) {
      return { success: false, error: saveRes.error }
    }

    skillRepository.setSkillActive(input.name, true)
    const refreshed = await skillRepository.listInstalledSkills(workspaceRoot)
    const savedSkill = refreshed.find((s) => s.name.toLowerCase() === input.name.toLowerCase())

    return { success: true, skill: savedSkill }
  }

  async resetSkillToOriginal(
    skillId: string,
    workspaceRoot?: string | null
  ): Promise<{ success: boolean; skill?: SkillDefinition; error?: string }> {
    const installed = await skillRepository.listInstalledSkills(workspaceRoot)
    const skill = installed.find((s) => s.id === skillId || s.name === skillId)

    if (!skill || !skill.originHub) {
      return { success: false, error: 'Cannot reset: skill has no registered hub origin' }
    }

    if (skill.originHubId) {
      return this.installFromHub(skill.name, workspaceRoot, skill.originHubId)
    }

    if (skill.originHub.startsWith('http')) {
      return this.installFromUrl(skill.originHub, workspaceRoot, skill.name)
    }

    return { success: false, error: `Cannot locate original source for ${skill.name}` }
  }

  async uninstallSkill(skillId: string, workspaceRoot?: string | null): Promise<{ success: boolean; error?: string }> {
    return skillRepository.deleteSkill(skillId, workspaceRoot)
  }

  async getMatchedSkills(userTaskOrContext: string | SkillMatchContext, workspaceRoot?: string | null, maxSkills: number = 3): Promise<SkillDefinition[]> {
    try {
      const availableSkills = await skillRepository.listInstalledSkills(workspaceRoot)
      if (availableSkills.length === 0) return []

      const ctx: SkillMatchContext = typeof userTaskOrContext === 'string'
        ? { userTask: userTaskOrContext, workspacePath: workspaceRoot || undefined }
        : { ...userTaskOrContext, workspacePath: userTaskOrContext.workspacePath || workspaceRoot || undefined }

      if (!ctx.projectStack && ctx.workspacePath) {
        ctx.projectStack = extractProjectStack(ctx.workspacePath)
      }

      return matchSkillsForTask(ctx, availableSkills, maxSkills)
    } catch (err: any) {
      logger.log('WARN', 'SkillAppService', `Error matching skills: ${err.message}`)
      return []
    }
  }

  async getContextSkillsBlock(userTaskOrContext: string | SkillMatchContext, workspaceRoot?: string | null, maxSkills: number = 3): Promise<string> {
    try {
      const matched = await this.getMatchedSkills(userTaskOrContext, workspaceRoot, maxSkills)
      if (matched.length === 0) return ''

      logger.log('INFO', 'SkillAppService', `Injected ${matched.length} contextual skill(s): ${matched.map((s) => s.name).join(', ')}`)
      return compileSkillsContextBlock(matched)
    } catch (err: any) {
      logger.log('WARN', 'SkillAppService', `Error getting context skills: ${err.message}`)
      return ''
    }
  }
}

export const skillAppService = new SkillAppService()
