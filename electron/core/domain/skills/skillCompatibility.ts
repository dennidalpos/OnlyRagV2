import type { HubSkillCompatibility, HubSkillItem, SkillDefinition } from './skillTypes'

export interface LocalModelProbe {
  name: string
}

export interface SkillCompatibilityInput {
  item: HubSkillItem
  installed?: SkillDefinition
  localModels: readonly LocalModelProbe[]
  remoteChecksum?: string
}

function findModel(requiredModel: string | undefined, localModels: readonly LocalModelProbe[]): string | undefined {
  if (!requiredModel) return undefined
  const wanted = requiredModel.trim().toLowerCase()
  return localModels.find((model) => {
    const installed = model.name.trim().toLowerCase()
    return installed === wanted || installed.split(':')[0] === wanted.split(':')[0]
  })?.name
}

export function assessHubSkillCompatibility(input: SkillCompatibilityInput): HubSkillCompatibility {
  const { item, installed, remoteChecksum } = input
  const matchedModel = findModel(item.requiredModel, input.localModels)
  const modelStatus: HubSkillCompatibility['modelStatus'] = item.requiredModel
    ? (matchedModel ? 'available' : input.localModels.length > 0 ? 'missing' : 'unknown')
    : 'not_required'

  const localChecksum = installed?.originChecksum
  const checksumStatus: HubSkillCompatibility['checksumStatus'] = !installed
    ? 'not_installed'
    : !localChecksum || !remoteChecksum
      ? 'unknown'
      : localChecksum === remoteChecksum
        ? 'match'
        : 'changed'

  const status: HubSkillCompatibility['status'] = modelStatus === 'missing'
    ? 'incompatible'
    : checksumStatus === 'changed'
      ? 'modified'
      : modelStatus === 'unknown' || checksumStatus === 'unknown'
        ? 'unknown'
        : 'compatible'

  return { status, modelStatus, checksumStatus, localChecksum, remoteChecksum, matchedModel }
}
