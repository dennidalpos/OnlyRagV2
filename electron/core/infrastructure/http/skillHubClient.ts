import { HubSkillItem, SkillHubSource } from '../../domain/skills/skillTypes'
import { ISkillHubAdapter } from './hubAdapters/hubAdapterInterface'
import { CuratedHubAdapter } from './hubAdapters/curatedHubAdapter'
import { AnthropicSkillsAdapter } from './hubAdapters/anthropicSkillsAdapter'
import { LobeHubAdapter } from './hubAdapters/lobeHubAdapter'
import { SkillsShAdapter } from './hubAdapters/skillsShAdapter'
import { JsonCatalogAdapter } from './hubAdapters/jsonCatalogAdapter'
import { GitHubRawAdapter } from './hubAdapters/githubRawAdapter'
import { webClient } from './webClient'
import { logger } from '../../../diagnostics'

interface CachedCatalogEntry {
  timestamp: number
  skills: HubSkillItem[]
}

export class SkillHubClient {
  private adapters: ISkillHubAdapter[] = [
    new CuratedHubAdapter(),
    new AnthropicSkillsAdapter(),
    new LobeHubAdapter(),
    new SkillsShAdapter(),
    new JsonCatalogAdapter(),
    new GitHubRawAdapter(),
  ]

  private catalogCache = new Map<string, CachedCatalogEntry>()
  private cacheTtlMs = 5 * 60 * 1000 // 5 minutes cache TTL

  clearCache(sourceId?: string) {
    if (sourceId) {
      this.catalogCache.delete(sourceId)
      logger.log('INFO', 'SkillHubClient', `Cleared cache for source: ${sourceId}`)
    } else {
      this.catalogCache.clear()
      logger.log('INFO', 'SkillHubClient', 'Cleared all catalog cache entries')
    }
  }

  async fetchSkillsFromSource(source: SkillHubSource, forceRefresh = false): Promise<HubSkillItem[]> {
    const cacheKey = `${source.id}_${source.url}`
    const now = Date.now()

    if (!forceRefresh && this.catalogCache.has(cacheKey)) {
      const cached = this.catalogCache.get(cacheKey)!
      if (now - cached.timestamp < this.cacheTtlMs && cached.skills.length > 0) {
        logger.log('INFO', 'SkillHubClient', `Returning cached catalog for source: ${source.name} (${cached.skills.length} skills)`)
        return cached.skills
      }
    }

    logger.log('INFO', 'SkillHubClient', `Fetching skills for source: ${source.name} (${source.url}) [forceRefresh: ${forceRefresh}]`)

    let fetchedSkills: HubSkillItem[] = []

    for (const adapter of this.adapters) {
      if (adapter.canHandle(source)) {
        try {
          const skills = await adapter.fetchSkills(source)
          if (skills.length > 0) {
            fetchedSkills = skills
            break
          }
        } catch (err: any) {
          logger.log('WARN', 'SkillHubClient', `Adapter failed for ${source.name}: ${err.message}`)
        }
      }
    }

    // Fallback: Try JSON catalog adapter directly if others didn't match or returned empty
    if (fetchedSkills.length === 0) {
      try {
        const jsonAdapter = new JsonCatalogAdapter()
        fetchedSkills = await jsonAdapter.fetchSkills(source)
      } catch {
        fetchedSkills = []
      }
    }

    if (fetchedSkills.length > 0) {
      this.catalogCache.set(cacheKey, { timestamp: now, skills: fetchedSkills })
    }

    return fetchedSkills
  }

  async fetchSkillContent(urlOrItem: string | HubSkillItem): Promise<{ success: boolean; content?: string; error?: string }> {
    if (typeof urlOrItem === 'object' && urlOrItem.rawContent) {
      return { success: true, content: urlOrItem.rawContent }
    }

    const url = typeof urlOrItem === 'string' ? urlOrItem : urlOrItem.downloadUrl
    if (!url) {
      return { success: false, error: 'No download URL or content available for skill' }
    }

    try {
      let targetUrl = url.trim()
      if (targetUrl.includes('github.com') && targetUrl.includes('/blob/')) {
        targetUrl = targetUrl
          .replace('github.com', 'raw.githubusercontent.com')
          .replace('/blob/', '/')
      }

      const res = await webClient.fetchWebContent(targetUrl, 50000)
      if (!res.success || !res.content) {
        return { success: false, error: res.error || 'Failed to fetch skill content from URL' }
      }

      const trimmedContent = res.content.trim()
      if (trimmedContent === '404: Not Found' || trimmedContent.startsWith('404: ') || trimmedContent.includes('404 Not Found')) {
        return { success: false, error: 'Skill file not found on remote server (HTTP 404)' }
      }

      return { success: true, content: res.content }
    } catch (err: any) {
      logger.log('ERROR', 'SkillHubClient', `Exception fetching skill from ${url}: ${err.message}`)
      return { success: false, error: err.message }
    }
  }
}

export const skillHubClient = new SkillHubClient()
