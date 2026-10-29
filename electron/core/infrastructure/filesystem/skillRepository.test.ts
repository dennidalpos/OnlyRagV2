import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { parseSkillFrontmatter, serializeSkillContent, calculateSkillChecksum, SkillRepository } from './skillRepository'

describe('SkillRepository Unit Tests', () => {
  let tempDir: string
  let repo: SkillRepository

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-skills-test-'))
    repo = new SkillRepository(tempDir)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it.each(['Use "quoted" text', String.raw`C:\temp\repo`, 'first\nsecond\n---\nlast', '  spaced : # [value] 😀  '])(
    'preserves every metadata field and the body through serialization/save/readback: %s',
    async (value) => {
      const metadata = {
        name: 'roundtrip',
        description: value,
        version: value,
        author: value,
        triggers: [value, 'Mixed Case', 'comma,value', value],
        tags: [value, 'false', 'null'],
        originHub: value,
        originHubId: value,
        originChecksum: value,
        isModified: false,
        requiredModel: value,
      }
      const body = ' \n# Body\n```yaml\n---\n```\n  trailing  \n\n'
      const serialized = serializeSkillContent(body, metadata)
      expect(parseSkillFrontmatter(serialized)).toEqual({ metadata, body })
      expect(await repo.saveSkill('roundtrip', body, tempDir, metadata)).toMatchObject({ success: true })
      const disk = fs.readFileSync(path.join(tempDir, 'skills/roundtrip/SKILL.md'), 'utf8')
      expect(disk).toBe(serialized)
      expect(parseSkillFrontmatter(disk)).toEqual({ metadata, body })
      const restarted = new SkillRepository(tempDir)
      expect((await restarted.listInstalledSkills(tempDir)).find((s) => s.id === 'roundtrip')).toMatchObject({
        id: 'roundtrip',
        description: value,
        content: body,
        triggers: metadata.triggers,
        tags: metadata.tags,
        originHub: value,
        originHubId: value,
        originChecksum: value,
      })
    },
  )

  it.each(['write', 'rename', 'readback'])('refuses failed activation %s, preserves prior disk/memory, and retries after recovery', (fault) => {
    repo.setSkillActive('previous', true)
    const state = path.join(tempDir, 'active_skills.json')
    const before = fs.readFileSync(state, 'utf8')
    const failure = Object.assign(new Error('controlled EACCES'), { code: 'EACCES' })
    if (fault === 'write')
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        throw failure
      })
    if (fault === 'rename')
      vi.spyOn(fs, 'renameSync').mockImplementation(() => {
        throw failure
      })
    if (fault === 'readback') {
      const read = fs.readFileSync
      vi.spyOn(fs, 'readFileSync').mockImplementation(((p: fs.PathOrFileDescriptor, ...args: unknown[]) =>
        String(p).includes('.tmp-') ? 'corrupt' : Reflect.apply(read, fs, [p, ...args])) as typeof read)
    }
    expect(() => repo.setSkillActive('next', true)).toThrow()
    expect(repo.isSkillActive('next')).toBe(false)
    expect(repo.isSkillActive('previous')).toBe(true)
    expect(fs.readFileSync(state, 'utf8')).toBe(before)
    expect(new SkillRepository(tempDir).isSkillActive('next')).toBe(false)
    vi.restoreAllMocks()
    repo.setSkillActive('next', true)
    expect(new SkillRepository(tempDir).isSkillActive('next')).toBe(true)
    expect(fs.readdirSync(tempDir).filter((p) => p.includes('.tmp-'))).toEqual([])
  })

  it('does not overwrite invalid activation state and permits retry after repair', () => {
    const state = path.join(tempDir, 'active_skills.json')
    fs.writeFileSync(state, '{invalid')
    expect(() => repo.setSkillActive('next', true)).toThrow()
    expect(fs.readFileSync(state, 'utf8')).toBe('{invalid')
    fs.writeFileSync(state, '["previous"]')
    repo.setSkillActive('next', true)
    expect(new SkillRepository(tempDir).isSkillActive('previous')).toBe(true)
  })

  it('keeps an existing skill intact when staged save fails', async () => {
    const first = await repo.saveSkill('existing', '# Previous', tempDir)
    const bytes = fs.readFileSync(first.filePath!, 'utf8')
    vi.spyOn(fs.promises, 'rename').mockRejectedValue(Object.assign(new Error('disk failure'), { code: 'EIO' }))
    expect(await repo.saveSkill('existing', '# Replacement', tempDir)).toMatchObject({ success: false })
    expect(fs.readFileSync(first.filePath!, 'utf8')).toBe(bytes)
  })

  it('should parse valid YAML frontmatter and markdown body', () => {
    const raw = `---
name: react-19-hooks
description: "React 19 Hooks standard patterns"
version: "1.2.0"
author: "Google DeepMind"
triggers: [react, hooks, useactionstate]
tags: [frontend, react]
origin_hub: "OnlyRag Official Core Hub"
origin_hub_id: "official-core"
origin_checksum: "a1b2c3d4"
is_modified: false
---

# React 19 Best Practices
Use useActionState instead of manual loading state.`

    const parsed = parseSkillFrontmatter(raw)
    expect(parsed.metadata.name).toBe('react-19-hooks')
    expect(parsed.metadata.description).toBe('React 19 Hooks standard patterns')
    expect(parsed.metadata.triggers).toContain('react')
    expect(parsed.metadata.triggers).toContain('useactionstate')
    expect(parsed.metadata.originHub).toBe('OnlyRag Official Core Hub')
    expect(parsed.metadata.originChecksum).toBe('a1b2c3d4')
    expect(parsed.metadata.isModified).toBe(false)
    expect(parsed.body).toContain('# React 19 Best Practices')
  })

  it('should parse multi-line YAML list items for triggers and tags', () => {
    const rawMultiline = `---
name: python-async
description: "Python async guidelines"
triggers:
  - asyncio
  - fastapi
  - aiohttp
tags:
  - python
  - backend
---

# Python Async Standards
Use asyncio.to_thread for blocking operations.`

    const parsed = parseSkillFrontmatter(rawMultiline)
    expect(parsed.metadata.name).toBe('python-async')
    expect(parsed.metadata.triggers).toEqual(['asyncio', 'fastapi', 'aiohttp'])
    expect(parsed.metadata.tags).toEqual(['python', 'backend'])
    expect(parsed.body).toContain('# Python Async Standards')
  })

  it('should calculate deterministic checksums for content', () => {
    const content1 = '# My Skill\nRule 1'
    const content2 = '# My Skill\r\nRule 1'
    const content3 = '# My Skill\nRule 2'

    expect(calculateSkillChecksum(content1)).toBe(calculateSkillChecksum(content2))
    expect(calculateSkillChecksum(content1)).not.toBe(calculateSkillChecksum(content3))
  })

  it('should persist active skills state across repository instances', () => {
    repo.setSkillActive('react19-modern-patterns', true)
    repo.setSkillActive('fastapi-pydantic-v2', true)
    expect(repo.isSkillActive('react19-modern-patterns')).toBe(true)

    // Instantiate a new repo instance with the same state directory
    const secondRepo = new SkillRepository(tempDir)
    expect(secondRepo.isSkillActive('react19-modern-patterns')).toBe(true)
    expect(secondRepo.isSkillActive('fastapi-pydantic-v2')).toBe(true)
    expect(secondRepo.isSkillActive('unknown-skill')).toBe(false)

    // Toggle off and verify persistence
    secondRepo.setSkillActive('react19-modern-patterns', false)
    const thirdRepo = new SkillRepository(tempDir)
    expect(thirdRepo.isSkillActive('react19-modern-patterns')).toBe(false)
    expect(thirdRepo.isSkillActive('fastapi-pydantic-v2')).toBe(true)
  })

  it('should save a new skill and list it from workspace with local_custom origin', async () => {
    const saveRes = await repo.saveSkill('tailwind-v4', '# Tailwind v4 Rules\nUse @theme directives instead of tailwind.config.js', tempDir, {
      description: 'Tailwind CSS v4 guidelines',
      triggers: ['tailwind', 'css'],
      tags: ['css', 'styling'],
    })

    expect(saveRes.success).toBe(true)
    expect(fs.existsSync(saveRes.filePath!)).toBe(true)

    const installed = await repo.listInstalledSkills(tempDir)
    expect(installed.length).toBeGreaterThanOrEqual(1)
    const found = installed.find((s) => s.name === 'tailwind-v4')
    expect(found).toBeDefined()
    expect(found?.description).toContain('Tailwind CSS v4 guidelines')
    expect(found?.originType).toBe('local_custom')
  })

  it('should reject an invalid explicit workspace scope instead of falling back to global skills', async () => {
    const invalidWorkspace = path.join(tempDir, 'missing-workspace')

    const saveRes = await repo.saveSkill('scoped-skill', '# Scoped', invalidWorkspace)

    expect(saveRes).toEqual({ success: false, error: 'Workspace scope is invalid or does not exist' })
    expect(fs.existsSync(path.join(tempDir, 'skills', 'scoped-skill'))).toBe(false)
  })

  it('should identify hub_original vs hub_modified based on checksum and flags', async () => {
    const originalBody = '# Fast API\nasync def endpoint(): pass'
    const originalChecksum = calculateSkillChecksum(originalBody)

    // Save as hub_original
    await repo.saveSkill('fastapi-test', originalBody, tempDir, {
      originHub: 'Official Hub',
      originHubId: 'official-core',
      originChecksum: originalChecksum,
      isModified: false,
    })

    let installed = await repo.listInstalledSkills(tempDir)
    let skill = installed.find((s) => s.name === 'fastapi-test')
    expect(skill?.originType).toBe('hub_original')
    expect(skill?.isModified).toBe(false)

    // Now modify the skill content directly
    const modifiedBody = '# Fast API\nasync def endpoint(): return "customized"'
    await repo.saveSkill('fastapi-test', modifiedBody, tempDir, {
      originHub: 'Official Hub',
      originHubId: 'official-core',
      originChecksum: originalChecksum,
      isModified: true,
    })

    installed = await repo.listInstalledSkills(tempDir)
    skill = installed.find((s) => s.name === 'fastapi-test')
    expect(skill?.originType).toBe('hub_modified')
    expect(skill?.isModified).toBe(true)
  })

  it('should delete a skill folder from workspace and clear active state', async () => {
    await repo.saveSkill('temp-skill', '# Temp', tempDir)
    repo.setSkillActive('temp-skill', true)
    expect(repo.isSkillActive('temp-skill')).toBe(true)

    const installedBefore = await repo.listInstalledSkills(tempDir)
    expect(installedBefore.some((s) => s.name === 'temp-skill')).toBe(true)

    const delRes = await repo.deleteSkill('temp-skill', tempDir)
    expect(delRes.success).toBe(true)

    const installedAfter = await repo.listInstalledSkills(tempDir)
    expect(installedAfter.some((s) => s.name === 'temp-skill')).toBe(false)
    expect(repo.isSkillActive('temp-skill')).toBe(false)
  })
})
