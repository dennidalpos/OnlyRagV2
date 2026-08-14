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

export class SkillHubClient {
  private adapters: ISkillHubAdapter[] = [
    new CuratedHubAdapter(),
    new AnthropicSkillsAdapter(),
    new LobeHubAdapter(),
    new SkillsShAdapter(),
    new JsonCatalogAdapter(),
    new GitHubRawAdapter(),
  ]

  async fetchSkillsFromSource(source: SkillHubSource): Promise<HubSkillItem[]> {
    logger.log('INFO', 'SkillHubClient', `Fetching skills for source: ${source.name} (${source.url})`)

    for (const adapter of this.adapters) {
      if (adapter.canHandle(source)) {
        try {
          const skills = await adapter.fetchSkills(source)
          if (skills.length > 0) return skills
        } catch (err: any) {
          logger.log('WARN', 'SkillHubClient', `Adapter failed for ${source.name}: ${err.message}`)
        }
      }
    }

    // Fallback: Try JSON catalog adapter directly if others didn't match
    try {
      const jsonAdapter = new JsonCatalogAdapter()
      return await jsonAdapter.fetchSkills(source)
    } catch {
      return []
    }
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

      return { success: true, content: res.content }
    } catch (err: any) {
      logger.log('ERROR', 'SkillHubClient', `Exception fetching skill from ${url}: ${err.message}`)
      return { success: false, error: err.message }
    }
  }
}

export const skillHubClient = new SkillHubClient()
