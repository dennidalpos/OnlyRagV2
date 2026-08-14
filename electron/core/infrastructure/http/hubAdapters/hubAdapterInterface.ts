import { HubSkillItem, SkillHubSource } from '../../../domain/skills/skillTypes'

export interface ISkillHubAdapter {
  canHandle(source: SkillHubSource): boolean
  fetchSkills(source: SkillHubSource): Promise<HubSkillItem[]>
}
