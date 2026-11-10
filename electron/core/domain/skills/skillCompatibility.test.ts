import { describe, expect, it } from 'vitest'
import { assessHubSkillCompatibility } from './skillCompatibility'
import type { HubSkillItem, SkillDefinition } from './skillTypes'

const item: HubSkillItem = {
  id: 'skill-a',
  name: 'skill-a',
  description: 'A useful local coding skill.',
  category: 'architecture',
  tags: ['coding'],
  triggers: ['coding'],
  version: '1.0.0',
  author: 'Test',
  requiredModel: 'qwen2.5-coder:7b',
}

const installed: SkillDefinition = {
  ...item,
  content: '# Skill',
  filePath: 'skill-a/SKILL.md',
  isActive: true,
  isWorkspaceLocal: true,
  originType: 'hub_original',
  originChecksum: 'local-checksum',
}

describe('hub skill local compatibility probe', () => {
  it('distinguishes a missing required local model', () => {
    expect(assessHubSkillCompatibility({ item, localModels: [], remoteChecksum: 'remote' }).status).toBe('unknown')
    expect(assessHubSkillCompatibility({ item, localModels: [{ name: 'llama3.2:3b' }], remoteChecksum: 'remote' }).status).toBe('incompatible')
  })

  it('reports checksum drift independently from model availability', () => {
    const result = assessHubSkillCompatibility({
      item,
      installed,
      localModels: [{ name: 'qwen2.5-coder:7b-instruct' }],
      remoteChecksum: 'remote-checksum',
    })

    expect(result.modelStatus).toBe('available')
    expect(result.checksumStatus).toBe('changed')
    expect(result.status).toBe('modified')
  })
})
