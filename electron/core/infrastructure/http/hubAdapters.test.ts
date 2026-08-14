import { describe, it, expect } from 'vitest'
import { CuratedHubAdapter } from './hubAdapters/curatedHubAdapter'
import { AnthropicSkillsAdapter } from './hubAdapters/anthropicSkillsAdapter'
import { LobeHubAdapter } from './hubAdapters/lobeHubAdapter'
import { SkillsShAdapter } from './hubAdapters/skillsShAdapter'
import { JsonCatalogAdapter } from './hubAdapters/jsonCatalogAdapter'
import { GitHubRawAdapter } from './hubAdapters/githubRawAdapter'
import { SkillHubSource } from '../../domain/skills/skillTypes'

describe('Skill Hub Adapters Unit Tests', () => {
  it('CuratedHubAdapter should handle builtin source and return core skills', async () => {
    const adapter = new CuratedHubAdapter()
    const source: SkillHubSource = {
      id: 'official-core',
      name: 'OnlyRag Official Core Hub',
      url: 'builtin://official-core',
      type: 'builtin',
      description: 'Core skills',
      isBuiltin: true,
    }

    expect(adapter.canHandle(source)).toBe(true)
    const skills = await adapter.fetchSkills(source)
    expect(skills.length).toBeGreaterThan(0)
    expect(skills.some((s) => s.id === 'react19-modern-patterns')).toBe(true)
    expect(skills.some((s) => s.id === 'typescript-clean-code')).toBe(true)
    expect(skills[0].hubName).toBe('OnlyRag Official Core Hub')
  })

  it('AnthropicSkillsAdapter should handle Anthropic repository and return skills', async () => {
    const adapter = new AnthropicSkillsAdapter()
    const source: SkillHubSource = {
      id: 'anthropics-skills',
      name: 'Anthropic Official Agent Skills',
      url: 'https://github.com/anthropics/skills',
      type: 'github-repo',
      description: 'Anthropic skills',
      isBuiltin: true,
    }

    expect(adapter.canHandle(source)).toBe(true)
    const skills = await adapter.fetchSkills(source)
    expect(skills.length).toBeGreaterThanOrEqual(10)
    expect(skills.some((s) => s.name === 'pdf')).toBe(true)
    expect(skills.some((s) => s.name === 'docx')).toBe(true)
    expect(skills.some((s) => s.name === 'pptx')).toBe(true)
    expect(skills.some((s) => s.name === 'xlsx')).toBe(true)
    expect(skills.some((s) => s.name === 'mcp-builder')).toBe(true)
    const pdfSkill = skills.find((s) => s.name === 'pdf')
    expect(pdfSkill?.rawContent).toContain('PyMuPDF')
  })

  it('LobeHubAdapter should handle LobeHub marketplace and return normalized tools', async () => {
    const adapter = new LobeHubAdapter()
    const source: SkillHubSource = {
      id: 'lobehub-skills',
      name: 'LobeHub Skills Marketplace',
      url: 'https://chat-plugins.lobehub.com',
      type: 'json-catalog',
      description: 'LobeHub skills',
      isBuiltin: true,
    }

    expect(adapter.canHandle(source)).toBe(true)
    const skills = await adapter.fetchSkills(source)
    expect(skills.length).toBeGreaterThan(0)
    expect(skills.some((s) => s.name.includes('weather') || s.name.includes('caption') || s.name.includes('stock') || s.name.includes('seo') || s.name.includes('crawler'))).toBe(true)
    expect(skills[0].rawContent).toContain('---')
  })

  it('SkillsShAdapter should handle Skills.sh directory and return engineering skills', async () => {
    const adapter = new SkillsShAdapter()
    const source: SkillHubSource = {
      id: 'skills-sh',
      name: 'Skills.sh Open Agent Directory',
      url: 'https://www.skills.sh/',
      type: 'github-repo',
      description: 'Skills.sh directory',
      isBuiltin: true,
    }

    expect(adapter.canHandle(source)).toBe(true)
    const skills = await adapter.fetchSkills(source)
    expect(skills.length).toBeGreaterThanOrEqual(10)
    expect(skills.some((s) => s.name === 'grill-me')).toBe(true)
    expect(skills.some((s) => s.name === 'code-review')).toBe(true)
    expect(skills.some((s) => s.name === 'diagnosing-bugs')).toBe(true)
    expect(skills.some((s) => s.name === 'tdd')).toBe(true)
  })

  it('JsonCatalogAdapter should identify json-catalog sources', () => {
    const adapter = new JsonCatalogAdapter()
    const jsonSource: SkillHubSource = {
      id: 'test-json',
      name: 'Test JSON Hub',
      url: 'https://example.com/hub.json',
      type: 'json-catalog',
      description: 'JSON test',
      isBuiltin: false,
    }
    expect(adapter.canHandle(jsonSource)).toBe(true)
  })

  it('GitHubRawAdapter should identify github repository sources', () => {
    const adapter = new GitHubRawAdapter()
    const ghSource: SkillHubSource = {
      id: 'test-gh',
      name: 'GitHub Skills',
      url: 'https://raw.githubusercontent.com/org/repo/main/SKILL.md',
      type: 'github-repo',
      description: 'GitHub test',
      isBuiltin: false,
    }
    expect(adapter.canHandle(ghSource)).toBe(true)
  })
})
