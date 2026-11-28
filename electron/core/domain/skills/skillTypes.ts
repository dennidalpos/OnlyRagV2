export interface SkillMetadata {
  name: string
  description: string
  version?: string
  author?: string
  triggers?: string[]
  tags?: string[]
  originHub?: string
  originHubId?: string
  originChecksum?: string
  isModified?: boolean
  requiredModel?: string
}

export type {
  CustomHubInput,
  HubSkillCompatibility,
  HubSkillItem,
  SkillCategory,
  SkillDefinition,
  SkillHubSource,
  SkillOriginType,
  SkillSaveInput,
} from '../../../../shared/types'
