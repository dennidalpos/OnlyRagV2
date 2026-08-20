import { HubSkillItem, SkillHubSource } from '../../../domain/skills/skillTypes'
import { ISkillHubAdapter } from './hubAdapterInterface'
import { webClient } from '../webClient'
import { parseSkillFrontmatter } from '../../filesystem/skillRepository'
import { logger } from '../../../../diagnostics'

export class GitHubRawAdapter implements ISkillHubAdapter {
  canHandle(source: SkillHubSource): boolean {
    return source.type === 'github-repo' || source.url.includes('github.com') || source.url.includes('raw.githubusercontent.com')
  }

  async fetchSkills(source: SkillHubSource): Promise<HubSkillItem[]> {
    try {
      logger.log('INFO', 'GitHubRawAdapter', `Fetching GitHub repo/raw skills from ${source.url}`)
      let targetUrl = source.url.trim()
      if (targetUrl.includes('github.com') && targetUrl.includes('/blob/')) {
        targetUrl = targetUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/')
      }

      const res = await webClient.fetchWebContent(targetUrl, 60000)
      if (!res.success || !res.content) {
        logger.log('WARN', 'GitHubRawAdapter', `Failed fetching content from ${source.url}: ${res.error}`)
        return []
      }

      // Only accept content that is genuinely a SKILL.md file with YAML frontmatter --
      // a repo-root or webpage URL (HTML) can otherwise be misidentified as valid skill
      // content just because it happens to contain a '# ' substring somewhere.
      if (res.content.trim().startsWith('---')) {
        const { metadata } = parseSkillFrontmatter(res.content)
        const name = metadata.name || 'imported-skill'
        const id = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-')

        return [
          {
            id,
            name,
            description: metadata.description || `Skill imported from ${source.name}`,
            category: 'architecture',
            tags: metadata.tags || ['github', 'skill'],
            triggers: metadata.triggers || [name.toLowerCase()],
            version: metadata.version || '1.0.0',
            author: metadata.author || source.name,
            rawContent: res.content,
            downloadUrl: targetUrl,
            hubId: source.id,
            hubName: source.name,
          },
        ]
      }

      return []
    } catch (err: any) {
      logger.log('ERROR', 'GitHubRawAdapter', `Error fetching GitHub raw skill: ${err.message}`)
      return []
    }
  }
}
