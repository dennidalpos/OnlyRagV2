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

  it('should not auto-install hub skills when autoInstallHubSkills option is disabled', async () => {
    // Uninstalled query for bigquery-sql from hub
    const matched = await skillAppService.getMatchedSkills('Optimize BigQuery SQL queries for data analytics', tempDir, 3, {
      autoInstallHubSkills: 'disabled',
    })
    expect(matched.length).toBe(0)

    const installed = await skillAppService.listInstalledSkills(tempDir)
    expect(installed.some((s) => s.name === 'bigquery-sql')).toBe(false)
  })

  it('should install an auto-discovered hub skill in prompt mode only after the user confirms', async () => {
    const candidates: { skillName: string; hubName: string; score: number }[] = []
    const matched = await skillAppService.getMatchedSkills(
      'Refactor the module following typescript clean code guidelines',
      tempDir,
      3,
      {
        autoInstallHubSkills: 'prompt',
        onConfirmInstall: async (candidate) => {
          candidates.push({ skillName: candidate.skillName, hubName: candidate.hubName, score: candidate.score })
          return true
        },
      }
    )

    expect(candidates.length).toBe(1)
    expect(candidates[0].skillName).toBe('typescript-clean-code')
    expect(candidates[0].hubName.length).toBeGreaterThan(0)
    expect(candidates[0].score).toBeGreaterThan(0)
    expect(matched.some((s) => s.name === 'typescript-clean-code')).toBe(true)

    const installed = await skillAppService.listInstalledSkills(tempDir)
    expect(installed.some((s) => s.name === 'typescript-clean-code')).toBe(true)
  })

  it('should skip the install in prompt mode when the user rejects it', async () => {
    const matched = await skillAppService.getMatchedSkills(
      'Refactor the module following typescript clean code guidelines',
      tempDir,
      3,
      { autoInstallHubSkills: 'prompt', onConfirmInstall: async () => false }
    )

    expect(matched.some((s) => s.name === 'typescript-clean-code')).toBe(false)
    const installed = await skillAppService.listInstalledSkills(tempDir)
    expect(installed.some((s) => s.name === 'typescript-clean-code')).toBe(false)
  })

  it('should never install without confirmation in prompt mode (regression: prompt behaved like auto)', async () => {
    await skillAppService.getMatchedSkills('Refactor the module following typescript clean code guidelines', tempDir, 3, {
      autoInstallHubSkills: 'prompt',
    })

    const installed = await skillAppService.listInstalledSkills(tempDir)
    expect(installed.some((s) => s.name === 'typescript-clean-code')).toBe(false)
  })

  it('should return empty skills when enableSkillRouter is false', async () => {
    await skillAppService.installFromHub('react19-modern-patterns', tempDir, 'official-core')
    const matched = await skillAppService.getMatchedSkills('Create a React 19 component', tempDir, 3, {
      enableSkillRouter: false,
    })
    expect(matched.length).toBe(0)

    const block = await skillAppService.getContextSkillsBlock('Create a React 19 component', tempDir, 3, {
      enableSkillRouter: false,
    })
    expect(block).toBe('')
  })

  it('should search every configured hub source during discovery, not just official-core (regression: auto-install only ever looked at the built-in hub, so user-added hubs could never be matched)', async () => {
    const sources = await skillAppService.listHubSources()
    const officialOnly = await skillAppService.listHubSkillsBySource('official-core', tempDir)
    const acrossSources = await skillAppService.listHubSkillsAcrossSources(tempDir)

    expect(acrossSources.length).toBeGreaterThanOrEqual(officialOnly.length)

    // Every returned item carries the hub it came from, which installFromHub needs to
    // fetch the right content, and names are deduplicated across sources.
    const names = acrossSources.map((s) => s.name.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
    expect(acrossSources.every((s) => Boolean(s.hubId))).toBe(true)
    expect(sources.some((src) => acrossSources.some((s) => s.hubId === src.id))).toBe(true)
  })
})
