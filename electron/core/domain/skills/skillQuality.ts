import type { HubSkillItem } from './skillTypes'

export interface HubSkillQuality {
  contentScore: number
  sourceScore: number
  totalScore: number
}

const TRUSTED_SOURCES: Record<string, number> = {
  'official-core': 100,
  'anthropics-skills': 95,
  'skills-sh': 85,
  'lobehub-skills': 70,
}

function scoreContent(item: HubSkillItem): number {
  let score = 0
  if (item.name.trim()) score += 10
  if (item.description.trim().length >= 24) score += 15
  if (item.tags.length > 0) score += 10
  if (item.triggers.length > 0) score += 10

  const content = item.rawContent?.trim() || ''
  if (content.length >= 200) score += 15
  if (content.length >= 800) score += 10
  if (/^#{1,3}\s/m.test(content)) score += 5
  if (/^\s*[-*]\s/m.test(content)) score += 5
  if (/example|verify|test|must|never|should/i.test(content)) score += 10

  return score
}

export function assessHubSkillQuality(item: HubSkillItem): HubSkillQuality {
  const contentScore = scoreContent(item)
  const sourceScore = TRUSTED_SOURCES[item.hubId || ''] ?? 45
  return {
    contentScore,
    sourceScore,
    totalScore: contentScore * 0.7 + sourceScore * 0.3,
  }
}

export function compareHubSkillQuality(a: HubSkillItem, b: HubSkillItem): number {
  const qualityDifference = assessHubSkillQuality(b).totalScore - assessHubSkillQuality(a).totalScore
  if (qualityDifference !== 0) return qualityDifference
  return a.name.localeCompare(b.name)
}
