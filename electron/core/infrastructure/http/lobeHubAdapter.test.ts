import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LobeHubAdapter } from './hubAdapters/lobeHubAdapter'
import { skillHubClient } from './skillHubClient'
import { webClient } from './webClient'
import { skillAppService } from '../../application/skillAppService'
import { calculateSkillChecksum, parseSkillFrontmatter, skillRepository } from '../filesystem/skillRepository'
import type { SkillHubSource } from '../../domain/skills/skillTypes'
import { useSkillNetworkFixture } from '../../../../scripts/test/skillNetworkFixture'

useSkillNetworkFixture()

const NL = String.fromCharCode(10)
const LOBE_URL = 'https://chat-plugins.lobehub.com'
const source: SkillHubSource = {
  id: 'lobehub-skills',
  name: 'LobeHub Skills Marketplace',
  url: LOBE_URL,
  type: 'json-catalog',
  description: 'LobeHub skills',
  isBuiltin: true,
}

const hostile = {
  identifier: 'Quote-Tool',
  author: 'Team "Quoted" \\ Backslash',
  manifest: 'https://example.invalid/manifest.json',
  meta: {
    title: 'Quote Tool',
    description: ['Says "hi"', 'second: line # not a comment', "it's 'single'"].join(NL),
    tags: ['a,b', 'Tag "Two"', 'C:\\temp', 'yes', 'null'],
  },
}

describe('LobeHub catalog entries with YAML-hostile metadata', () => {
  let workspace: string

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-lobe-'))
    vi.mocked(webClient.fetchWebContent).mockImplementation(async (url) => {
      if (url === LOBE_URL) {
        return {
          success: true,
          content: JSON.stringify({
            plugins: [hostile, { identifier: 'weird-types', author: { not: 'text' }, meta: { description: 42, tags: [1, true, null] } }],
          }),
        }
      }
      throw new Error(`Missing offline web fixture for ${url}`)
    })
  })

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  it('generates frontmatter that parses back to the exact catalog values', async () => {
    const skills = await new LobeHubAdapter().fetchSkills(source)
    const item = skills.find((s) => s.name === 'quote-tool')!
    const { metadata, body } = parseSkillFrontmatter(item.rawContent!)

    expect(metadata.name).toBe('quote-tool')
    expect(metadata.author).toBe(hostile.author)
    expect(metadata.description).toBe(hostile.meta.description)
    expect(metadata.tags).toEqual(hostile.meta.tags.map((t) => t.toLowerCase()))
    expect(metadata.triggers).toEqual(['quote-tool', ...hostile.meta.tags.map((t) => t.toLowerCase())])
    expect(metadata.originHub).toBe('LobeHub Skills Marketplace')
    expect(body).toContain('# Quote Tool')
    expect(body).not.toContain('author:')
  })

  it('coerces non-string catalog values instead of failing or emitting broken YAML', async () => {
    const skills = await new LobeHubAdapter().fetchSkills(source)
    const item = skills.find((s) => s.name === 'weird-types')!
    const { metadata } = parseSkillFrontmatter(item.rawContent!)
    expect(metadata.name).toBe('weird-types')
    expect(metadata.description).toBe('42')
    expect(metadata.tags).toEqual(['1', 'true', 'null'])
  })

  it('returns the same content through get-content and installs it with matching checksum and metadata', async () => {
    const [item] = (await new LobeHubAdapter().fetchSkills(source)).filter((s) => s.name === 'quote-tool')
    const content = await skillHubClient.fetchSkillContent(item)
    expect(content.success).toBe(true)
    expect(content.content).toBe(item.rawContent)

    const installed = await skillAppService.installFromHub(item.id, workspace, source.id, false)
    expect(installed.success).toBe(true)
    const stored = (await skillRepository.listInstalledSkills(workspace)).find((s) => s.name === 'quote-tool')!
    expect(stored.author).toBe(hostile.author)
    expect(stored.description).toBe(hostile.meta.description)
    expect(stored.tags).toEqual(hostile.meta.tags.map((t) => t.toLowerCase()))
    expect(stored.originChecksum).toBe(calculateSkillChecksum(parseSkillFrontmatter(item.rawContent!).body))
    expect(stored.originType).toBe('hub_original')
  })
})
