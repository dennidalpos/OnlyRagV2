import { HubSkillItem, SkillHubSource, SkillCategory } from '../../../domain/skills/skillTypes'
import { ISkillHubAdapter } from './hubAdapterInterface'
import { webClient } from '../webClient'
import { logger } from '../../../../diagnostics'

function mapLobeCategory(category?: string): SkillCategory {
  const clean = (category || '').toLowerCase()
  if (clean.includes('web') || clean.includes('search') || clean.includes('crawler')) return 'backend'
  if (clean.includes('media') || clean.includes('image') || clean.includes('draw') || clean.includes('video')) return 'frontend'
  if (clean.includes('stock') || clean.includes('finance') || clean.includes('crypto')) return 'database'
  if (clean.includes('science') || clean.includes('edu') || clean.includes('math')) return 'ai-ml'
  if (clean.includes('sec') || clean.includes('auth')) return 'security'
  if (clean.includes('game') || clean.includes('lifestyle') || clean.includes('social')) return 'frontend'
  return 'architecture'
}

function generateLobeSkillContent(item: any): string {
  const name = item.meta?.title || item.identifier || 'lobehub-tool'
  const desc = item.meta?.description || 'LobeHub Community Skill & Tool'
  const identifier = item.identifier || name
  const author = item.author || 'LobeHub Community'
  const tags = Array.isArray(item.meta?.tags) ? item.meta.tags : ['lobehub', 'tool']
  const manifest = item.manifest || 'https://chat-plugins.lobehub.com'

  return `---
name: ${identifier.toLowerCase()}
description: "${desc.replace(/"/g, "'")}"
version: "1.0.0"
author: "${author}"
triggers: [${[identifier.toLowerCase(), ...tags.map((t: string) => t.toLowerCase())].map((t) => `"${t}"`).join(', ')}]
tags: [${tags.map((t: string) => `"${t.toLowerCase()}"`).join(', ')}]
origin_hub: "LobeHub Skills Marketplace"
---

# ${name} — AI Tool Guidelines

## 1. Overview
${desc}

- **Identifier**: \`${identifier}\`
- **Author**: ${author}
- **Manifest**: ${manifest}

## 2. Agent Usage & Workflows
- Quando l'utente richiede funzionalità relative a \`${identifier}\`, consulta i tag di integrazione: ${tags.join(', ')}.
- Esegui le chiamate API o i comandi shell corrispondenti verificando sempre i parametri richiesti dal manifest.
`
}

export class LobeHubAdapter implements ISkillHubAdapter {
  canHandle(source: SkillHubSource): boolean {
    return (
      source.id === 'lobehub-skills' ||
      source.url.includes('lobehub.com') ||
      source.url.includes('chat-plugins.lobehub.com')
    )
  }

  async fetchSkills(source: SkillHubSource): Promise<HubSkillItem[]> {
    logger.log('INFO', 'LobeHubAdapter', 'Fetching LobeHub Skills and Plugins registry')

    const targetUrl = source.url.startsWith('http') && source.url.includes('chat-plugins')
      ? source.url
      : 'https://chat-plugins.lobehub.com'

    try {
      const res = await webClient.fetchWebContent(targetUrl, 150000)
      if (!res.success || !res.content) {
        throw new Error(res.error || 'Failed to fetch LobeHub index')
      }

      let parsed: any
      try {
        parsed = JSON.parse(res.content)
      } catch {
        const cleaned = res.content.replace(/^```(json)?/i, '').replace(/```$/, '').trim()
        parsed = JSON.parse(cleaned)
      }

      const pluginsList = Array.isArray(parsed) ? parsed : Array.isArray(parsed.plugins) ? parsed.plugins : []
      const items: HubSkillItem[] = []

      for (const p of pluginsList) {
        if (!p || typeof p !== 'object') continue
        const identifier = (p.identifier || p.name || 'unnamed-plugin').toString()
        const title = (p.meta?.title || p.title || identifier).toString()
        const desc = (p.meta?.description || p.description || `LobeHub Skill for ${title}`).toString()
        const category = mapLobeCategory(p.meta?.category || p.category)
        const tags = Array.isArray(p.meta?.tags) ? p.meta.tags.map((t: any) => String(t).toLowerCase()) : ['lobehub']
        const triggers = [identifier.toLowerCase(), ...tags]

        items.push({
          id: `lobehub-${identifier.toLowerCase()}`,
          name: identifier.toLowerCase(),
          description: desc,
          category,
          tags,
          triggers,
          version: '1.0.0',
          author: (p.author || 'LobeHub Community').toString(),
          downloadUrl: p.manifest || 'https://chat-plugins.lobehub.com',
          rawContent: generateLobeSkillContent(p),
          hubId: source.id,
          hubName: source.name,
        })
      }

      if (items.length > 0) return items
    } catch (err: any) {
      logger.log('WARN', 'LobeHubAdapter', `Live LobeHub fetch failed: ${err.message}. Using fallback.`)
    }

    return this.getFallbackLobeHubSkills(source)
  }

  private getFallbackLobeHubSkills(source: SkillHubSource): HubSkillItem[] {
    const fallbackList = [
      {
        id: 'lobehub-videocaptions',
        name: 'videocaptions',
        description: 'Convert YouTube links into transcribed text, ask questions, create chapters, and summarize content.',
        category: 'frontend' as SkillCategory,
        tags: ['video-to-text', 'youtube', 'transcription', 'lobehub'],
        triggers: ['youtube', 'video-transcribe', 'videocaptions', 'transcription'],
        version: '1.0.0',
        author: 'maila',
      },
      {
        id: 'lobehub-gituserrepostats',
        name: 'gituserrepostats',
        description: 'Dynamically generate and analyze stats and history for open-source repositories and developers.',
        category: 'backend' as SkillCategory,
        tags: ['github', 'oss', 'git-stats', 'lobehub'],
        triggers: ['github-stats', 'repo-stats', 'oss-stats', 'gituserrepostats'],
        version: '1.0.0',
        author: 'yunwei37',
      },
      {
        id: 'lobehub-weathergpt',
        name: 'weathergpt',
        description: 'Get real-time worldwide weather updates, meteorological forecasts, and alerts.',
        category: 'backend' as SkillCategory,
        tags: ['weather', 'forecast', 'realtime', 'lobehub'],
        triggers: ['weather', 'forecast', 'weathergpt'],
        version: '1.0.0',
        author: 'steven-tey',
      },
      {
        id: 'lobehub-stockdata',
        name: 'stockdata',
        description: 'Analyze stocks and get comprehensive real-time investment data, fundamentals, and analytics.',
        category: 'database' as SkillCategory,
        tags: ['stock', 'finance', 'investing', 'lobehub'],
        triggers: ['stock', 'finance', 'stockdata', 'investment'],
        version: '1.0.0',
        author: 'portfoliometa',
      },
      {
        id: 'lobehub-seo-assistant',
        name: 'seo-assistant',
        description: 'Generate search engine keyword information, on-page SEO audits, and content optimizations.',
        category: 'architecture' as SkillCategory,
        tags: ['seo', 'keyword', 'audit', 'lobehub'],
        triggers: ['seo', 'seo-assistant', 'keyword-optimization'],
        version: '1.0.0',
        author: 'webfx',
      },
      {
        id: 'lobehub-access-google-sheets',
        name: 'access-google-sheets',
        description: 'Query and chat with Google Sheets, parse formulas, and automate spreadsheet workflows.',
        category: 'database' as SkillCategory,
        tags: ['google-sheets', 'excel', 'spreadsheet', 'lobehub'],
        triggers: ['google-sheets', 'sheets-api', 'excel-chat'],
        version: '1.0.0',
        author: 'accessplugins',
      },
      {
        id: 'lobehub-website-crawler',
        name: 'website-crawler',
        description: 'Extract and clean markdown content from public web links, documentation pages, and articles.',
        category: 'backend' as SkillCategory,
        tags: ['crawler', 'scraper', 'web-extract', 'lobehub'],
        triggers: ['crawler', 'website-crawler', 'scrape-web'],
        version: '1.0.0',
        author: 'LobeHub',
      },
    ]

    return fallbackList.map((item) => ({
      ...item,
      rawContent: generateLobeSkillContent({
        identifier: item.name,
        author: item.author,
        meta: { title: item.name, description: item.description, tags: item.tags, category: item.category },
      }),
      hubId: source.id,
      hubName: source.name,
    }))
  }
}
