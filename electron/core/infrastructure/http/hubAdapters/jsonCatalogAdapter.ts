import { HubSkillItem, SkillHubSource, SkillCategory } from '../../../domain/skills/skillTypes'
import { ISkillHubAdapter } from './hubAdapterInterface'
import { webClient } from '../webClient'
import { logger } from '../../../../diagnostics'

function normalizeCategory(raw?: string): SkillCategory {
  const clean = (raw || '').toLowerCase().trim()
  if (clean.includes('front') || clean.includes('ui') || clean.includes('css') || clean.includes('react') || clean.includes('vue')) {
    return 'frontend'
  }
  if (clean.includes('back') || clean.includes('api') || clean.includes('server') || clean.includes('fastapi') || clean.includes('node')) {
    return 'backend'
  }
  if (clean.includes('data') || clean.includes('sql') || clean.includes('rag') || clean.includes('vector')) {
    return 'database'
  }
  if (clean.includes('sec') || clean.includes('auth') || clean.includes('guard')) {
    return 'security'
  }
  if (clean.includes('ai') || clean.includes('ml') || clean.includes('llm') || clean.includes('vision')) {
    return 'ai-ml'
  }
  if (clean.includes('ops') || clean.includes('ci') || clean.includes('git') || clean.includes('docker')) {
    return 'devops'
  }
  return 'architecture'
}

function parseArrayField(field: any): string[] {
  if (Array.isArray(field)) {
    return field.map((f) => String(f).trim().toLowerCase()).filter(Boolean)
  }
  if (typeof field === 'string') {
    return field.split(',').map((f) => f.trim().toLowerCase()).filter(Boolean)
  }
  return []
}

export class JsonCatalogAdapter implements ISkillHubAdapter {
  canHandle(source: SkillHubSource): boolean {
    return source.type === 'json-catalog' || source.url.endsWith('.json')
  }

  async fetchSkills(source: SkillHubSource): Promise<HubSkillItem[]> {
    try {
      logger.log('INFO', 'JsonCatalogAdapter', `Fetching hub catalog from ${source.url}`)
      const res = await webClient.fetchWebContent(source.url, 100000)
      if (!res.success || !res.content) {
        logger.log('WARN', 'JsonCatalogAdapter', `Failed fetching catalog from ${source.url}: ${res.error}`)
        return []
      }

      // Try to parse JSON from fetched content
      let rawJson: any
      try {
        rawJson = JSON.parse(res.content)
      } catch {
        // Strip markdown code block wrappers if any
        const cleaned = res.content.replace(/^```(json)?/i, '').replace(/```$/, '').trim()
        rawJson = JSON.parse(cleaned)
      }

      const list = Array.isArray(rawJson)
        ? rawJson
        : Array.isArray(rawJson.skills)
        ? rawJson.skills
        : Array.isArray(rawJson.items)
        ? rawJson.items
        : Object.values(rawJson)

      const normalized: HubSkillItem[] = []
      for (const item of list) {
        if (!item || typeof item !== 'object') continue
        const name = (item.name || item.title || item.id || item.slug || 'untitled-skill').toString().trim()
        const id = (item.id || item.slug || name).toString().toLowerCase().replace(/[^a-z0-9-_]/g, '-')
        const description = (item.description || item.desc || item.summary || `Skill guideline for ${name}`).toString().trim()
        const category = normalizeCategory(item.category || item.type || item.tags?.[0])
        const tags = parseArrayField(item.tags || item.keywords || item.topics)
        const triggers = parseArrayField(item.triggers || item.activation || item.matchWords)
        const version = (item.version || item.ver || '1.0.0').toString()
        const author = (item.author || item.maintainer || item.creator || source.name || 'Community').toString()
        const rawContent = item.rawContent || item.content || item.markdown || item.body
        const downloadUrl = item.downloadUrl || item.url || item.rawUrl || item.fileUrl

        normalized.push({
          id,
          name,
          description,
          category,
          tags: tags.length > 0 ? tags : ['skill', id],
          triggers: triggers.length > 0 ? triggers : [name.toLowerCase()],
          version,
          author,
          rawContent,
          downloadUrl,
          hubId: source.id,
          hubName: source.name,
        })
      }

      return normalized
    } catch (err: any) {
      logger.log('ERROR', 'JsonCatalogAdapter', `Error parsing JSON catalog for ${source.name}: ${err.message}`)
      return []
    }
  }
}
