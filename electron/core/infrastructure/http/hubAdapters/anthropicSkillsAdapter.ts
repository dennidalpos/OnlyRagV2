import { HubSkillItem, SkillHubSource, SkillCategory } from '../../../domain/skills/skillTypes'
import { ISkillHubAdapter } from './hubAdapterInterface'
import { webClient } from '../webClient'
import { logger } from '../../../../diagnostics'

export const ANTHROPIC_KNOWN_SKILLS: Record<string, { description: string; category: SkillCategory; triggers: string[]; tags: string[] }> = {
  'pdf': {
    description: 'PDF text extraction, form filling, page rotation, merging, splitting, OCR, and document generation.',
    category: 'backend',
    triggers: ['pdf', 'pypdf', 'pdf-form', 'extract-pdf', 'merge-pdf', 'ocr'],
    tags: ['pdf', 'document', 'anthropic', 'extraction'],
  },
  'docx': {
    description: 'Word document (.docx) generation, styling, tables, paragraph formatting, and template population.',
    category: 'backend',
    triggers: ['docx', 'word', 'doc', 'document', 'word-doc'],
    tags: ['docx', 'word', 'office', 'anthropic'],
  },
  'pptx': {
    description: 'PowerPoint (.pptx) presentation generation, slide layout design, styling, and charts.',
    category: 'frontend',
    triggers: ['pptx', 'powerpoint', 'presentation', 'slides', 'deck'],
    tags: ['pptx', 'powerpoint', 'presentation', 'anthropic'],
  },
  'xlsx': {
    description: 'Excel (.xlsx) spreadsheets, formulas, financial modeling, chart generation, and data analysis.',
    category: 'database',
    triggers: ['xlsx', 'excel', 'spreadsheet', 'sheet', 'openpyxl', 'formula'],
    tags: ['xlsx', 'excel', 'data', 'finance', 'anthropic'],
  },
  'mcp-builder': {
    description: 'Model Context Protocol (MCP) server development, tool schema definitions, resources, and prompts.',
    category: 'architecture',
    triggers: ['mcp', 'mcp-server', 'model-context-protocol', 'mcp-builder', 'tool-definition'],
    tags: ['mcp', 'agent', 'architecture', 'anthropic'],
  },
  'web-artifacts-builder': {
    description: 'Interactive HTML, CSS, React, and Canvas artifacts creation with real-time UI components.',
    category: 'frontend',
    triggers: ['artifact', 'react-artifact', 'html-artifact', 'web-artifact', 'component'],
    tags: ['frontend', 'react', 'artifacts', 'anthropic'],
  },
  'webapp-testing': {
    description: 'Automated end-to-end web testing, browser automation, Playwright/Puppeteer flows, and test assertion.',
    category: 'devops',
    triggers: ['testing', 'web-testing', 'playwright', 'e2e', 'test-suite'],
    tags: ['testing', 'qa', 'automation', 'anthropic'],
  },
  'algorithmic-art': {
    description: 'Generative mathematical art, p5.js, Canvas, SVG procedural patterns, and visual animations.',
    category: 'frontend',
    triggers: ['art', 'p5js', 'generative-art', 'canvas-art', 'procedural'],
    tags: ['art', 'canvas', 'p5js', 'creative', 'anthropic'],
  },
  'canvas-design': {
    description: 'Visual UI design principles, layout composition, typography hierarchy, and color palettes.',
    category: 'frontend',
    triggers: ['design', 'canvas-design', 'layout', 'typography', 'visual-design'],
    tags: ['design', 'ui', 'frontend', 'anthropic'],
  },
  'brand-guidelines': {
    description: 'Brand voice adherence, editorial guidelines, corporate communications, and content consistency.',
    category: 'architecture',
    triggers: ['brand', 'brand-guidelines', 'corporate-voice', 'editorial', 'communication'],
    tags: ['brand', 'guidelines', 'content', 'anthropic'],
  },
  'claude-api': {
    description: 'Anthropic Claude API client integration, prompt caching, tool calling, and streaming parameters.',
    category: 'backend',
    triggers: ['claude-api', 'anthropic-api', 'prompt-caching', 'messages-api'],
    tags: ['anthropic', 'api', 'claude', 'backend'],
  },
  'doc-coauthoring': {
    description: 'Collaborative technical documentation, RFC writing, architecture decision records (ADRs), and editing.',
    category: 'architecture',
    triggers: ['documentation', 'rfc', 'adr', 'coauthor', 'tech-doc'],
    tags: ['documentation', 'technical-writing', 'anthropic'],
  },
  'frontend-design': {
    description: 'Modern frontend design patterns, Tailwind CSS, accessible components, and responsive layouts.',
    category: 'frontend',
    triggers: ['frontend-design', 'tailwind', 'ui-components', 'responsive'],
    tags: ['frontend', 'css', 'design', 'anthropic'],
  },
  'internal-comms': {
    description: 'Internal company memos, sprint updates, release notes, and executive status summaries.',
    category: 'architecture',
    triggers: ['internal-comms', 'release-notes', 'memo', 'status-update'],
    tags: ['communication', 'management', 'anthropic'],
  },
  'skill-creator': {
    description: 'Meta-skill for authoring, testing, and packaging new Agent Skills adhering to agentskills.io standard.',
    category: 'architecture',
    triggers: ['create-skill', 'skill-authoring', 'agentskills', 'skill-creator'],
    tags: ['skills', 'meta', 'agentskills', 'anthropic'],
  },
  'slack-gif-creator': {
    description: 'Procedural Slack emoji, GIF animations, and visual micro-assets generation.',
    category: 'frontend',
    triggers: ['slack-gif', 'gif-creator', 'emoji-animation'],
    tags: ['animation', 'slack', 'creative', 'anthropic'],
  },
  'theme-factory': {
    description: 'Comprehensive design system token generation, dark/light theme palettes, and CSS variables.',
    category: 'frontend',
    triggers: ['theme-factory', 'color-tokens', 'theme-generator', 'design-tokens'],
    tags: ['theme', 'tokens', 'styling', 'anthropic'],
  },
}

const ANTHROPIC_DETAILED_DIRECTIVES: Record<string, string> = {
  pdf: `## 2. Best Practices & Workflows
- Esegui l'estrazione testo preservando la gerarchia dei titoli e tabelle con PyMuPDF (fitz) o pdfplumber.
- Per PDF scansionati o raster, attiva l'OCR visivo locale con mappatura delle coordinate.
- Verifica sempre che i PDF compilati o esportati siano conformi a PDF/A o standard PDF 1.7.`,
  docx: `## 2. Best Practices & Workflows
- Genera documenti Word formattati con \`python-docx\` rispettando stili coerenti e intestazioni (H1, H2, H3).
- Definisci bordi, larghezze colonne e allineamento esplicito per tutte le tabelle.`,
  xlsx: `## 2. Best Practices & Workflows
- Utilizza \`openpyxl\` per formule Excel, formattazione condizionale e modelli multi-foglio.
- Mantieni separati i fogli dei dati grezzi da quelli delle metriche e dashboard aggregate.`,
  pptx: `## 2. Best Practices & Workflows
- Genera presentazioni con \`python-pptx\` adottando layout 16:9 moderni e contrasto elevato.
- Utilizza griglie di layout coerenti per testo, diagrammi e callout visivi.`,
  'mcp-builder': `## 2. Best Practices & Workflows
- Implementa protocolli JSON-RPC 2.0 per server MCP (Model Context Protocol).
- Definisci schemi di validazione JSON Schema rigorosi per tutti i parametri dei tool.`,
  'webapp-testing': `## 2. Best Practices & Workflows
- Scrivi test E2E/Playwright stabili utilizzando selettori semantici accessibili (\`getByRole\`, \`getByLabel\`).
- Isola gli stati dei test e azzera i cookie/localStorage prima di ogni suite.`,
  'web-artifacts-builder': `## 2. Best Practices & Workflows
- Costruisci componenti React/HTML isolati e privi di dipendenze esterne non dichiarate.
- Assicura piena reattività visiva e gestione degli stati di caricamento/errore.`,
}

function generateAnthropicSkillContent(name: string, info: { description: string; category: SkillCategory; triggers: string[]; tags: string[] }): string {
  const customDirectives = ANTHROPIC_DETAILED_DIRECTIVES[name] || `## 2. Best Practices & Tool Workflows
- Quando operi su file o istruzioni pertinenti a \`${name}\`, rispetta le convenzioni di sicurezza e architettura standard \`agentskills.io\`.
- Esegui i comandi e le manipolazioni di formato verificando sempre la corretta codifica UTF-8 e la validazione dei dati di input.`

  return `---
name: ${name}
description: "${info.description.replace(/"/g, "'")}"
version: "1.0.0"
author: "Anthropic"
triggers: [${info.triggers.map((t) => `"${t}"`).join(', ')}]
tags: [${info.tags.map((t) => `"${t}"`).join(', ')}]
origin_hub: "Anthropic Official Agent Skills"
---

# ${name.toUpperCase()} — Anthropic Agent Skill Guidelines

## 1. Scope & Capabilities
${info.description}

${customDirectives}
`
}

export class AnthropicSkillsAdapter implements ISkillHubAdapter {
  canHandle(source: SkillHubSource): boolean {
    return (
      source.id === 'anthropics-skills' ||
      source.url.includes('github.com/anthropics/skills') ||
      source.url.includes('raw.githubusercontent.com/anthropics/skills')
    )
  }

  async fetchSkills(source: SkillHubSource): Promise<HubSkillItem[]> {
    logger.log('INFO', 'AnthropicAdapter', 'Fetching official Anthropic Agent Skills repository')

    const skillNames = new Set<string>(Object.keys(ANTHROPIC_KNOWN_SKILLS))

    // 1. Try to query GitHub repository contents API dynamically
    try {
      const apiUrl = 'https://api.github.com/repos/anthropics/skills/contents/skills'
      const res = await webClient.fetchWebContent(apiUrl, 100000)
      if (res.success && res.content) {
        try {
          const parsed = JSON.parse(res.content)
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item && item.type === 'dir' && item.name) {
                skillNames.add(item.name)
              }
            }
          }
        } catch {
          // fallback to known skills
        }
      }
    } catch (err: any) {
      logger.log('WARN', 'AnthropicAdapter', `GitHub API contents lookup failed: ${err.message}. Using verified catalog.`)
    }

    const items: HubSkillItem[] = []
    for (const name of skillNames) {
      const info = ANTHROPIC_KNOWN_SKILLS[name] || {
        description: `Official Anthropic Agent Skill for ${name}`,
        category: 'architecture' as SkillCategory,
        triggers: [name.toLowerCase()],
        tags: ['anthropic', 'skill', name.toLowerCase()],
      }

      const rawDownloadUrl = `https://raw.githubusercontent.com/anthropics/skills/main/skills/${name}/SKILL.md`

      items.push({
        id: `anthropic-${name}`,
        name,
        description: info.description,
        category: info.category,
        tags: info.tags,
        triggers: info.triggers,
        version: '1.0.0',
        author: 'Anthropic',
        downloadUrl: rawDownloadUrl,
        rawContent: generateAnthropicSkillContent(name, info),
        hubId: source.id,
        hubName: source.name,
      })
    }

    return items
  }
}
