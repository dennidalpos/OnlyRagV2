import type { HubSkillItem, SkillHubSource } from '../skills/skillTypes'

/** One skill hub protocol; adapters live in infrastructure/http/hubAdapters. */
export interface ISkillHubAdapter {
  canHandle(source: SkillHubSource): boolean
  fetchSkills(source: SkillHubSource): Promise<HubSkillItem[]>
}
