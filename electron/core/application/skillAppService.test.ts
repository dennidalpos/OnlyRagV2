import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { skillAppService } from './skillAppService'
import https from 'node:https'
import http from 'node:http'
import { useSkillNetworkFixture } from '../../../scripts/test/skillNetworkFixture'
import { skillRepository, SkillRepository, parseSkillFrontmatter } from '../infrastructure/filesystem/skillRepository'
import { userDataRoot } from '../infrastructure/filesystem/userDataRoot'

const network = useSkillNetworkFixture()

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

  it('refuses and records unexpected native HTTP(S) before forwarding', () => {
    expect(() => https.get('https://unexpected.invalid/catalog')).toThrow('Unexpected native')
    expect(() => http.request('http://unexpected.invalid/catalog')).toThrow('Unexpected native')
    expect(network.refused).toEqual(['https://unexpected.invalid/catalog', 'http://unexpected.invalid/catalog'])
    network.refused.length = 0 // only these deliberate guard probes are expected
  })

  it('uses controlled hub responses through concrete discovery adapters without native requests', async () => {
    const skills = await skillAppService.listHubSkillsAcrossSources(tempDir, true)
    expect(network.requested).toContain('https://api.github.com/repos/anthropics/skills/contents/skills')
    expect(network.requested).toContain('https://chat-plugins.lobehub.com')
    expect(skills.some((s) => s.hubId === 'lobehub-skills' && s.name === 'fixture-search')).toBe(true)
    expect(skills.some((s) => s.hubId === 'anthropics-skills')).toBe(true)
  })

  it('installs native metadata from a controlled URL, and preserves it on disk', async () => {
    const result = await skillAppService.installFromUrl('https://fixture.invalid/native/SKILL.md', tempDir)
    expect(result.success).toBe(true)
    expect(result.skill).toMatchObject({ isActive: true, description: 'Native "quoted" metadata', originType: 'hub_original' })
    expect(parseSkillFrontmatter(fs.readFileSync(result.skill!.filePath, 'utf8')).metadata.requiredModel).toBe('local:3b')
    const edited = await skillAppService.createOrUpdateSkill({ name: result.skill!.name, content: ' \n# Edited\n\n' }, tempDir)
    expect(edited).toMatchObject({ success: true, skill: { requiredModel: 'local:3b', description: 'Native "quoted" metadata', content: ' \n# Edited\n\n' } })
  })

  it('uses the saved canonical name for activation and reread, retaining native metadata and body on save', async () => {
    const body = '\n# Native body\n  trailing  \n'
    const result = await skillAppService.createOrUpdateSkill(
      {
        name: 'Native Skill',
        content: '---\nname: ignored-name\ndescription: Use "quotes"\nrequired_model: local:3b\ntriggers: ["Mixed Case", "comma,value"]\n---\n' + body,
      },
      tempDir,
    )
    expect(result).toMatchObject({
      success: true,
      skill: {
        id: 'native-skill',
        isActive: true,
        description: 'Use "quotes"',
        requiredModel: 'local:3b',
        content: body,
        triggers: ['Mixed Case', 'comma,value'],
      },
    })
    expect(new SkillRepository(userDataRoot()).isSkillActive('native-skill')).toBe(true)
  })

  it.each(['save', 'hub', 'url'])('reports failed activation to the %s consumer and retries truthfully', async (consumer) => {
    const name = consumer === 'hub' ? 'react19-modern-patterns' : consumer === 'url' ? 'native' : 'saved-fixture'
    skillRepository.setSkillActive(name, false)
    const state = path.join(userDataRoot(), 'active_skills.json')
    const before = fs.readFileSync(state, 'utf8')
    const rename = fs.renameSync
    const fault = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to) === state) throw Object.assign(new Error('controlled EACCES'), { code: 'EACCES' })
      return rename(from, to)
    })
    const run = () =>
      consumer === 'hub'
        ? skillAppService.installFromHub(name, tempDir, 'official-core')
        : consumer === 'url'
          ? skillAppService.installFromUrl('https://fixture.invalid/native/SKILL.md', tempDir)
          : skillAppService.createOrUpdateSkill({ name, description: 'Use "quotes"', content: '# Saved' }, tempDir)
    expect(await run()).toMatchObject({ success: false, error: expect.stringContaining('activation was not saved') })
    expect(skillRepository.isSkillActive(name)).toBe(false)
    expect(fs.readFileSync(state, 'utf8')).toBe(before)
    expect(new SkillRepository(userDataRoot()).isSkillActive(name)).toBe(false)
    fault.mockRestore()
    expect(await run()).toMatchObject({ success: true, skill: { isActive: true } })
    expect(new SkillRepository(userDataRoot()).isSkillActive(name)).toBe(true)
  })

  it('returns false for a failed toggle without changing the persisted or listed activation', async () => {
    await skillAppService.createOrUpdateSkill({ name: 'toggle-fixture', description: 'Fixture', content: '# Fixture' }, tempDir)
    const fault = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('controlled activation failure')
    })
    expect(skillAppService.toggleSkillActive('toggle-fixture', false)).toBe(false)
    expect((await skillAppService.listInstalledSkills(tempDir)).find((s) => s.id === 'toggle-fixture')?.isActive).toBe(true)
    expect(new SkillRepository(userDataRoot()).isSkillActive('toggle-fixture')).toBe(true)
    fault.mockRestore()
    expect(skillAppService.toggleSkillActive('toggle-fixture', false)).toBe(true)
    expect(new SkillRepository(userDataRoot()).isSkillActive('toggle-fixture')).toBe(false)
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

  it('withdraws a versioned skill from the turn block once the manifest declares another major', async () => {
    const installRes = await skillAppService.installFromHub('tailwind-css-v4', tempDir, 'official-core')
    expect(installRes.success).toBe(true)
    const skills = installRes.skill ? [installRes.skill] : []

    // Matched before package.json exists: nothing contradicts it yet.
    expect(skillAppService.skillsBlockForWorkspace(skills, tempDir)).toContain('tailwind-css-v4')

    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ devDependencies: { tailwindcss: '^3.4.1' } }), 'utf-8')
    expect(skillAppService.skillsBlockForWorkspace(skills, tempDir)).toBe('')

    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ devDependencies: { tailwindcss: '^4.1.0' } }), 'utf-8')
    expect(skillAppService.skillsBlockForWorkspace(skills, tempDir)).toContain('tailwind-css-v4')
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
      tempDir,
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
      tempDir,
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
      tempDir,
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

  it('should still match installed skills when hub auto-install is disabled', async () => {
    await skillAppService.installFromHub('react19-modern-patterns', tempDir, 'official-core')
    const matched = await skillAppService.getMatchedSkills('Create a React 19 component', tempDir, 3, {
      autoInstallHubSkills: 'disabled',
    })

    expect(matched.some((skill) => skill.name === 'react19-modern-patterns')).toBe(true)
  })

  it('should install an auto-discovered hub skill in prompt mode only after the user confirms', async () => {
    const candidates: { skillName: string; hubName: string; score: number }[] = []
    const matched = await skillAppService.getMatchedSkills('Refactor the module following typescript clean code guidelines', tempDir, 3, {
      autoInstallHubSkills: 'prompt',
      onConfirmInstall: async (candidate) => {
        candidates.push({ skillName: candidate.skillName, hubName: candidate.hubName, score: candidate.score })
        return true
      },
    })

    expect(candidates.length).toBe(1)
    expect(candidates[0].skillName).toBe('typescript-clean-code')
    expect(candidates[0].hubName.length).toBeGreaterThan(0)
    expect(candidates[0].score).toBeGreaterThan(0)
    expect(matched.some((s) => s.name === 'typescript-clean-code')).toBe(true)

    const installed = await skillAppService.listInstalledSkills(tempDir)
    expect(installed.some((s) => s.name === 'typescript-clean-code')).toBe(true)
  })

  it('should skip the install in prompt mode when the user rejects it', async () => {
    const matched = await skillAppService.getMatchedSkills('Refactor the module following typescript clean code guidelines', tempDir, 3, {
      autoInstallHubSkills: 'prompt',
      onConfirmInstall: async () => false,
    })

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
    expect(acrossSources.every((s, index) => s.globalRank === index + 1)).toBe(true)
    expect(acrossSources.every((s) => s.qualityScore !== undefined)).toBe(true)
  })

  it('should fetch raw skill content for a hub skill', async () => {
    const skills = await skillAppService.listHubSkillsBySource('official-core', tempDir)
    expect(skills.length).toBeGreaterThan(0)
    const contentRes = await skillAppService.getHubSkillContent(skills[0])
    expect(contentRes.success).toBe(true)
    expect(contentRes.content).toBeDefined()
    expect(contentRes.content?.length).toBeGreaterThan(20)
  })
})
