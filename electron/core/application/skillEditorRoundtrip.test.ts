import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { skillAppService } from './skillAppService'
import { skillRepository } from '../infrastructure/filesystem/skillRepository'
import type { SkillSaveInput } from '../../../shared/types'

const NL = String.fromCharCode(10)

describe('skill editor payload through save-custom and back', () => {
  let workspace: string

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-skill-roundtrip-'))
  })

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  it('keeps lists, metadata and body unchanged when the payload is resubmitted untouched', async () => {
    const payload: SkillSaveInput = {
      name: 'roundtrip-editor',
      description: 'Plain description',
      version: '2.3.4',
      author: 'Local',
      triggers: ['Mixed Case', 'comma,value', 'C:\\temp\\repo', '"quoted"'],
      tags: ['a,b', 'false', 'Tag One'],
      content: ['# Body', '', '  indented line', '', '- item', ''].join(NL),
    }
    const first = await skillAppService.createOrUpdateSkill(payload, workspace)
    expect(first.success).toBe(true)
    const stored = (await skillRepository.listInstalledSkills(workspace)).find((s) => s.name === 'roundtrip-editor')!
    const filePath = stored.filePath
    const bytesBefore = fs.readFileSync(filePath, 'utf-8')

    // What the editor sends for an untouched skill: the stored values, not re-parsed ones.
    const resubmit: SkillSaveInput = {
      name: stored.name,
      description: stored.description,
      version: stored.version,
      author: stored.author,
      triggers: [...stored.triggers],
      tags: [...stored.tags],
      content: stored.content,
    }
    expect((await skillAppService.createOrUpdateSkill(resubmit, workspace)).success).toBe(true)

    const reread = (await skillRepository.listInstalledSkills(workspace)).find((s) => s.name === 'roundtrip-editor')!
    expect(reread.triggers).toEqual(payload.triggers)
    expect(reread.tags).toEqual(payload.tags)
    expect(reread.content).toBe(stored.content)
    expect(reread.description).toBe(payload.description)
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(bytesBefore)
  })
})
