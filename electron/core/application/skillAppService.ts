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

  async listHubSkillsBySource(sourceId: string, workspaceRoot?: string | null): Promise<HubSkillItem[]> {
    const sources = await customHubRepository.listSources()
    const source = sources.find((s) => s.id === sourceId) || sources[0]
    if (!source) return []

    const installed = await skillRepository.listInstalledSkills(workspaceRoot)
    const installedNames = new Set(installed.map((s) => s.name.toLowerCase()))

    const skills = await skillHubClient.fetchSkillsFromSource(source)
    return skills.map((item) => ({
      ...item,
      isInstalled: installedNames.has(item.name.toLowerCase()) || installedNames.has(item.id.toLowerCase()),
    }))
  }

  async listHubSkills(workspaceRoot?: string | null): Promise<HubSkillItem[]> {
    return this.listHubSkillsBySource('official-core', workspaceRoot)
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
      return matchSkillsForTask(userTaskOrContext, availableSkills, maxSkills)
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
