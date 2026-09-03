import { skillRepository, calculateSkillChecksum, parseSkillFrontmatter } from '../infrastructure/filesystem/skillRepository'
import { customHubRepository } from '../infrastructure/filesystem/customHubRepository'
import { skillHubClient } from '../infrastructure/http/skillHubClient'
import { projectStackDetectionRepository } from '../infrastructure/filesystem/projectStackDetectionRepository'
import { matchSkillsForTask, matchHubSkillsForTask, compileSkillsContextBlock, SkillMatchContext } from '../domain/skills/skillMatcher'
import { assessHubSkillQuality, compareHubSkillQuality } from '../domain/skills/skillQuality'
import { assessHubSkillCompatibility, LocalModelProbe } from '../domain/skills/skillCompatibility'
import { ollamaHttpClient } from '../infrastructure/http/ollamaHttpClient'
import {
  SkillDefinition,
  HubSkillItem,
  SkillHubSource,
  CustomHubInput,
  SkillSaveInput,
} from '../domain/skills/skillTypes'
import { logger } from '../../diagnostics'
import type { SkillInstallCandidate } from './skillInstallApprovalService'

/** Options driving the contextual skill router and the hub auto-install policy. */
export interface SkillMatchingOptions {
  enableSkillRouter?: boolean
  autoInstallHubSkills?: 'disabled' | 'prompt'
  autoInstallMinScore?: number
  /** Asks the user to confirm an install; required by the 'prompt' policy. */
  onConfirmInstall?: (candidate: SkillInstallCandidate) => Promise<boolean>
}

export class SkillAppService {
  private localModelProbe: Promise<LocalModelProbe[]> | null = null

  private async getLocalModelProbe(forceRefresh = false): Promise<LocalModelProbe[]> {
    if (forceRefresh || !this.localModelProbe) {
      this.localModelProbe = ollamaHttpClient.getModelMetrics().then((metrics) =>
        Object.keys(metrics).map((name) => ({ name }))
      )
    }
    return this.localModelProbe
  }

  private decorateHubSkill(
    item: HubSkillItem,
    installed: SkillDefinition[],
    localModels: readonly LocalModelProbe[],
  ): HubSkillItem {
    const parsed = item.rawContent ? parseSkillFrontmatter(item.rawContent) : null
    const enriched = parsed && parsed.metadata.requiredModel
      ? { ...item, requiredModel: parsed.metadata.requiredModel }
      : item
    const installedSkill = installed.find((skill) =>
      skill.name.toLowerCase() === item.name.toLowerCase() || skill.id.toLowerCase() === item.id.toLowerCase()
    )
    const remoteChecksum = parsed ? calculateSkillChecksum(parsed.body || item.rawContent || '') : undefined
    const qualityScore = assessHubSkillQuality(enriched).totalScore
    return {
      ...enriched,
      qualityScore,
      compatibility: assessHubSkillCompatibility({
        item: enriched,
        installed: installedSkill,
        localModels,
        remoteChecksum,
      }),
      isInstalled: Boolean(installedSkill),
    }
  }

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
    const skills = await skillHubClient.fetchSkillsFromSource(source, forceRefresh)
    const localModels = await this.getLocalModelProbe(forceRefresh)
    return skills
      .map((item) => this.decorateHubSkill(item, installed, localModels))
      .sort(compareHubSkillQuality)
  }

  async listHubSkills(workspaceRoot?: string | null, forceRefresh = false): Promise<HubSkillItem[]> {
    return this.listHubSkillsBySource('official-core', workspaceRoot, forceRefresh)
  }

  /**
   * Every skill offered by EVERY configured hub source, deduplicated by name with the
   * first source in the user's ordering winning. Used by the auto-discovery path in
   * getMatchedSkills: restricting that search to 'official-core' meant hubs the user had
   * deliberately added were never considered for auto-install.
   * A source that fails to fetch is skipped, never fatal to the others.
   */
  async listHubSkillsAcrossSources(workspaceRoot?: string | null, forceRefresh = false): Promise<HubSkillItem[]> {
    const sources = await customHubRepository.listSources()
    if (sources.length === 0) return []

    const installed = await skillRepository.listInstalledSkills(workspaceRoot)
    const localModels = await this.getLocalModelProbe(forceRefresh)

    const merged: HubSkillItem[] = []

    for (const source of sources) {
      let skills: HubSkillItem[] = []
      try {
        skills = await skillHubClient.fetchSkillsFromSource(source, forceRefresh)
      } catch (err: any) {
        logger.log('WARN', 'SkillAppService', `Hub source '${source.name}' skipped during discovery: ${err.message}`)
        continue
      }

      for (const item of skills) {
        const key = item.name.toLowerCase()
        const candidate = this.decorateHubSkill({
          ...item,
          hubId: item.hubId || source.id,
          hubName: item.hubName || source.name,
        }, installed, localModels)
        const existingIndex = merged.findIndex((existing) => existing.name.toLowerCase() === key)
        if (existingIndex < 0) {
          merged.push(candidate)
        } else if (compareHubSkillQuality(candidate, merged[existingIndex]) < 0) {
          merged[existingIndex] = candidate
        }
      }
    }

    return merged
      .sort(compareHubSkillQuality)
      .map((item, index) => ({ ...item, globalRank: index + 1 }))
  }

  toggleSkillActive(skillId: string, isActive: boolean): boolean {
    skillRepository.setSkillActive(skillId, isActive)
    logger.log('INFO', 'SkillAppService', `Toggled skill '${skillId}' active: ${isActive}`)
    return true
  }

  async getHubSkillContent(item: HubSkillItem | string): Promise<{ success: boolean; content?: string; error?: string }> {
    return skillHubClient.fetchSkillContent(item)
  }

  async installFromHub(
    hubSkillId: string,
    workspaceRoot?: string | null,
    hubSourceId?: string,
    activateByDefault = true
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

    skillRepository.setSkillActive(hubItem.name, activateByDefault)
    const installed = await skillRepository.listInstalledSkills(workspaceRoot)
    const newSkill = installed.find((s) => s.name.toLowerCase() === hubItem.name.toLowerCase())

    return { success: true, skill: newSkill }
  }

  async installFromUrl(
    url: string,
    workspaceRoot?: string | null,
    customName?: string,
    activateByDefault = true
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

    skillRepository.setSkillActive(skillName, activateByDefault)
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

  /**
   * Decides whether an auto-discovered hub skill may be installed. In 'prompt' mode the
   * decision belongs to the user: without a confirmation channel the install is skipped
   * rather than silently performed as if the mode were 'auto'.
   */
  private async confirmHubInstall(
    hubMatch: { item: HubSkillItem; score: number },
    autoInstallMode: 'disabled' | 'prompt',
    onConfirmInstall?: SkillMatchingOptions['onConfirmInstall']
  ): Promise<boolean> {
    if (autoInstallMode !== 'prompt') return true
    if (!onConfirmInstall) {
      logger.log('WARN', 'SkillAppService', `Install of '${hubMatch.item.name}' skipped: no confirmation channel available in 'prompt' mode.`)
      return false
    }
    return onConfirmInstall({
      skillName: hubMatch.item.name,
      skillDescription: hubMatch.item.description,
      hubName: hubMatch.item.hubName || hubMatch.item.hubId || 'Hub sconosciuto',
      score: hubMatch.score,
    })
  }

  async getMatchedSkills(
    userTaskOrContext: string | SkillMatchContext,
    workspaceRoot?: string | null,
    maxSkills: number = 3,
    options?: SkillMatchingOptions
  ): Promise<SkillDefinition[]> {
    try {
      if (options?.enableSkillRouter === false) {
        return []
      }

      let availableSkills = await skillRepository.listInstalledSkills(workspaceRoot)

      const ctx: SkillMatchContext = typeof userTaskOrContext === 'string'
        ? { userTask: userTaskOrContext, workspacePath: workspaceRoot || undefined }
        : { ...userTaskOrContext, workspacePath: userTaskOrContext.workspacePath || workspaceRoot || undefined }

      if (!ctx.projectStack && ctx.workspacePath) {
        ctx.projectStack = projectStackDetectionRepository.detect(ctx.workspacePath)
      }

      let matched = matchSkillsForTask(ctx, availableSkills, maxSkills)

      // Auto-discovery from enabled Hubs if enabled and additional domain skills are needed
      const autoInstallMode = options?.autoInstallHubSkills ?? 'disabled'
      const minScore = options?.autoInstallMinScore ?? 8.0

      if (autoInstallMode !== 'disabled' && matched.length < maxSkills) {
        try {
          const hubItems = await this.listHubSkillsAcrossSources(workspaceRoot, false)
          const installedNames = new Set(availableSkills.map((s) => s.name.toLowerCase()))
          const uninstalledHubItems = hubItems.filter((item) => !installedNames.has(item.name.toLowerCase()))

          if (uninstalledHubItems.length > 0) {
            const hubMatches = matchHubSkillsForTask(ctx, uninstalledHubItems, minScore)
            if (hubMatches.length > 0) {
              const topHubMatch = hubMatches[0]
              logger.log(
                'INFO',
                'SkillAppService',
                `Auto-discovered high confidence hub skill '${topHubMatch.item.name}' (score: ${topHubMatch.score}).`
              )
              const isInstallAllowed = await this.confirmHubInstall(topHubMatch, autoInstallMode, options?.onConfirmInstall)
              if (isInstallAllowed) {
                const installRes = await this.installFromHub(topHubMatch.item.id, workspaceRoot, topHubMatch.item.hubId, true)
                if (installRes.success) {
                  availableSkills = await skillRepository.listInstalledSkills(workspaceRoot)
                  matched = matchSkillsForTask(ctx, availableSkills, maxSkills)
                }
              }
            }
          }
        } catch (hubErr: any) {
          logger.log('WARN', 'SkillAppService', `Hub auto-discovery check skipped: ${hubErr.message}`)
        }
      }

      return matched
    } catch (err: any) {
      logger.log('WARN', 'SkillAppService', `Error matching skills: ${err.message}`)
      return []
    }
  }

  async getContextSkillsBlock(
    userTaskOrContext: string | SkillMatchContext,
    workspaceRoot?: string | null,
    maxSkills: number = 3,
    options?: SkillMatchingOptions
  ): Promise<string> {
    try {
      const matched = await this.getMatchedSkills(userTaskOrContext, workspaceRoot, maxSkills, options)
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
