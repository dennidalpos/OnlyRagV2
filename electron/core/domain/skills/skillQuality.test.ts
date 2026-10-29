import { describe, expect, it } from 'vitest'
import { assessHubSkillQuality, compareHubSkillQuality } from './skillQuality'
import type { HubSkillItem } from './skillTypes'

const baseSkill: HubSkillItem = {
  id: 'skill-a',
  name: 'architecture-review',
  description: 'Architecture review guidance for modular software systems.',
  category: 'architecture',
  tags: ['architecture'],
  triggers: ['architecture'],
  version: '1.0.0',
  author: 'Community',
}

describe('hub skill quality assessment', () => {
  it('rewards actionable, structured content from trusted sources', () => {
    const quality = assessHubSkillQuality({
      ...baseSkill,
      hubId: 'official-core',
      rawContent: '# Rules\n\n- Must keep boundaries clear.\n- Verify with tests.\n\n## Example\n```ts\nconst value = 1\n```\n',
    })

    expect(quality.contentScore).toBeGreaterThan(60)
    expect(quality.sourceScore).toBe(100)
  })

  it('prefers a richer trusted candidate when duplicate names come from different hubs', () => {
    const weak = { ...baseSkill, hubId: 'custom-hub' }
    const strong = {
      ...baseSkill,
      id: 'skill-b',
      hubId: 'official-core',
      rawContent: '# Guidance\n\n- Must verify changes.\n- Never skip tests.\n\n## Example\n'.repeat(20),
    }

    expect(compareHubSkillQuality(strong, weak)).toBeLessThan(0)
  })
})
