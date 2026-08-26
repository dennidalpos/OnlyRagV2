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

export type SkillOriginType = 'local_custom' | 'hub_original' | 'hub_modified'

export interface SkillDefinition {
  id: string
  name: string
  description: string
  content: string
  filePath: string
  isActive: boolean
  isWorkspaceLocal: boolean
  triggers: string[]
  tags: string[]
  version?: string
  author?: string
  originType: SkillOriginType
  originHub?: string
  originHubId?: string
  originChecksum?: string
  isModified?: boolean
}

export type SkillCategory = 'frontend' | 'backend' | 'database' | 'security' | 'architecture' | 'ai-ml' | 'devops'

export interface HubSkillItem {
  id: string
  name: string
  description: string
  category: SkillCategory
  tags: string[]
  triggers: string[]
  rawContent?: string
  downloadUrl?: string
  version: string
  author: string
  hubId?: string
  hubName?: string
  isInstalled?: boolean
  requiredModel?: string
  qualityScore?: number
  globalRank?: number
  compatibility?: HubSkillCompatibility
}

export interface HubSkillCompatibility {
  status: 'compatible' | 'modified' | 'incompatible' | 'unknown'
  modelStatus: 'not_required' | 'available' | 'missing' | 'unknown'
  checksumStatus: 'not_installed' | 'match' | 'changed' | 'unknown'
  localChecksum?: string
  remoteChecksum?: string
  matchedModel?: string
}

export type HubSourceType = 'builtin' | 'json-catalog' | 'github-repo'

export interface SkillHubSource {
  id: string
  name: string
  url: string
  type: HubSourceType
  description: string
  isBuiltin: boolean
  isReadOnly?: boolean
}

export interface CustomHubInput {
  name: string
  url: string
  type?: HubSourceType
  description?: string
}

export interface SkillSaveInput {
  name: string
  description?: string
  version?: string
  author?: string
  triggers?: string[]
  tags?: string[]
  content: string
  originHub?: string
  originHubId?: string
  originChecksum?: string
  isModified?: boolean
}
