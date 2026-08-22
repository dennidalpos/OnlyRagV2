import { describe, it, expect } from 'vitest'
import {
  UPSTREAM_MODULES,
  CATEGORY_TABS,
  type DependencyCategory,
} from './AboutModal'

describe('AboutModal & Credits Data Integrity Unit Tests', () => {
  it('should define a comprehensive list of upstream open-source modules', () => {
    expect(UPSTREAM_MODULES.length).toBeGreaterThanOrEqual(30)
  })

  it('should have non-empty, well-formed fields for every upstream module', () => {
    const names = new Set<string>()

    for (const item of UPSTREAM_MODULES) {
      expect(item.name).toBeDefined()
      expect(item.name.trim().length).toBeGreaterThan(0)

      // No duplicate names
      expect(names.has(item.name)).toBe(false)
      names.add(item.name)

      expect(item.version).toBeDefined()
      expect(item.version.trim().length).toBeGreaterThan(0)

      expect(item.description).toBeDefined()
      expect(item.description.trim().length).toBeGreaterThan(0)

      expect(item.license).toBeDefined()
      expect(item.license.trim().length).toBeGreaterThan(0)

      expect(item.category).toBeDefined()
      expect(['core', 'aiAndVector', 'uiAndEditor', 'skillsAndEcosystem']).toContain(item.category)

      expect(item.url).toBeDefined()
      expect(item.url.startsWith('https://')).toBe(true)
    }
  })

  it('should categorize modules into valid category buckets', () => {
    const validCategories: DependencyCategory[] = [
      'core',
      'aiAndVector',
      'uiAndEditor',
      'skillsAndEcosystem',
    ]

    const tabCategoryIds = CATEGORY_TABS.map((t) => t.id)
    expect(tabCategoryIds).toContain('all')

    for (const cat of validCategories) {
      expect(tabCategoryIds).toContain(cat)
      const count = UPSTREAM_MODULES.filter((m) => m.category === cat).length
      expect(count).toBeGreaterThan(0)
    }
  })

  it('should include all foundational core technologies', () => {
    const moduleNames = UPSTREAM_MODULES.map((m) => m.name)

    // Core
    expect(moduleNames).toContain('Electron')
    expect(moduleNames).toContain('React 19')
    expect(moduleNames).toContain('TypeScript')
    expect(moduleNames).toContain('TypeScript Compiler API')
    expect(moduleNames).toContain('Vite')
    expect(moduleNames).toContain('Tailwind CSS')
    expect(moduleNames).toContain('Vitest')
    expect(moduleNames).toContain('Electron Builder')

    // AI & Vector
    expect(moduleNames).toContain('LanceDB')
    expect(moduleNames).toContain('Apache Arrow')
    expect(moduleNames).toContain('FlashRank')
    expect(moduleNames).toContain('Ollama')
    expect(moduleNames).toContain('FastAPI & Uvicorn')
    expect(moduleNames).toContain('PyMuPDF (fitz)')
    expect(moduleNames).toContain('RapidOCR (ONNX Runtime)')
    expect(moduleNames).toContain('Pydantic')
    expect(moduleNames).toContain('HTTPX')
    expect(moduleNames).toContain('ftfy')

    // UI & Editor
    expect(moduleNames).toContain('Monaco Editor')
    expect(moduleNames).toContain('Lucide React')
    expect(moduleNames).toContain('node-pty')
    expect(moduleNames).toContain('TanStack Virtual')
    expect(moduleNames).toContain('Diff (diff)')

    // Skills & Ecosystem
    expect(moduleNames).toContain('Skills.sh Directory')
    expect(moduleNames).toContain('Anthropic Agent Skills')
    expect(moduleNames).toContain('LobeHub Marketplace')
    expect(moduleNames).toContain('Turndown & Cheerio')
    expect(moduleNames).toContain('js-yaml')
    expect(moduleNames).toContain('JsonRepair')
    expect(moduleNames).toContain('GPT-Tokenizer')
  })
})
