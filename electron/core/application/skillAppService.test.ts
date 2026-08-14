import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { skillAppService } from './skillAppService'

describe('SkillAppService Unit Tests', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-appservice-test-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('should list default hub sources with official core', async () => {
    const sources = await skillAppService.listHubSources()
    expect(sources.length).toBeGreaterThanOrEqual(1)
    expect(sources.some((s) => s.id === 'official-core')).toBe(true)
  })

  it('should list hub skills for official core', async () => {
    const hubSkills = await skillAppService.listHubSkillsBySource('official-core', tempDir)
    expect(hubSkills.length).toBeGreaterThan(0)
    expect(hubSkills.some((s) => s.name === 'react19-modern-patterns')).toBe(true)
  })

  it('should install a skill from official hub and track it as hub_original', async () => {
    const installRes = await skillAppService.installFromHub('react19-modern-patterns', tempDir, 'official-core')
    expect(installRes.success).toBe(true)
    expect(installRes.skill).toBeDefined()
    expect(installRes.skill?.name).toBe('react19-modern-patterns')
    expect(installRes.skill?.originType).toBe('hub_original')
    expect(installRes.skill?.isModified).toBe(false)
  })

  it('should create a custom local skill and mark it as local_custom', async () => {
    const saveRes = await skillAppService.createOrUpdateSkill(
      {
        name: 'custom-logging-pattern',
        description: 'Logging best practices',
        content: '# Logging Rules\nAlways use structured JSON.',
        triggers: ['logging', 'json'],
        tags: ['backend', 'logging'],
      },
      tempDir
    )

    expect(saveRes.success).toBe(true)
    expect(saveRes.skill?.originType).toBe('local_custom')
  })

  it('should mark an edited hub skill as hub_modified', async () => {
    // 1. Install from hub
    await skillAppService.installFromHub('fastapi-pydantic-v2', tempDir, 'official-core')

    // 2. Edit the skill content
    const editRes = await skillAppService.createOrUpdateSkill(
      {
        name: 'fastapi-pydantic-v2',
        description: 'FastAPI modified guidelines',
        content: '# FastAPI Modified\nCustom endpoint rule.',
      },
      tempDir
    )

    expect(editRes.success).toBe(true)
    expect(editRes.skill?.originType).toBe('hub_modified')
    expect(editRes.skill?.isModified).toBe(true)
  })

  it('should reset a modified hub skill back to original', async () => {
    // 1. Install
    await skillAppService.installFromHub('lancedb-vector-search', tempDir, 'official-core')

    // 2. Modify
    await skillAppService.createOrUpdateSkill(
      {
        name: 'lancedb-vector-search',
        description: 'Modified LanceDB',
        content: '# Changed LanceDB content',
      },
      tempDir
    )

    let installed = await skillAppService.listInstalledSkills(tempDir)
    let modifiedSkill = installed.find((s) => s.name === 'lancedb-vector-search')
    expect(modifiedSkill?.originType).toBe('hub_modified')

    // 3. Reset
    const resetRes = await skillAppService.resetSkillToOriginal('lancedb-vector-search', tempDir)
    expect(resetRes.success).toBe(true)
    expect(resetRes.skill?.originType).toBe('hub_original')
    expect(resetRes.skill?.isModified).toBe(false)
  })

  it('should match installed active skills for a task prompt', async () => {
    await skillAppService.installFromHub('react19-modern-patterns', tempDir, 'official-core')
    const matched = await skillAppService.getMatchedSkills('Create a React 19 component with useActionState', tempDir)
    expect(matched.length).toBeGreaterThan(0)
    expect(matched[0].name).toBe('react19-modern-patterns')
  })
})
