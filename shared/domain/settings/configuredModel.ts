import type { AppSettings } from '../../types'

export type ConfiguredModelRole = 'chat' | 'coding' | 'translation'

const ROLE_SETTING = {
  chat: 'chatModel',
  coding: 'codingModel',
  translation: 'translationModel',
} as const satisfies Record<ConfiguredModelRole, keyof AppSettings>

type ModelSettings = Partial<Pick<AppSettings, 'defaultModel' | 'chatModel' | 'codingModel' | 'translationModel'>>

/**
 * The single resolution of "which model runs this": an explicit choice, then the role's setting,
 * then `defaultModel`. Returns '' when none is configured — never a guessed model name that may
 * not be installed; callers report `noConfiguredModelMessage` instead.
 */
export function resolveConfiguredModel(role: ConfiguredModelRole, settings: ModelSettings | null | undefined, explicit?: string | null): string {
  for (const candidate of [explicit, settings?.[ROLE_SETTING[role]], settings?.defaultModel]) {
    const model = typeof candidate === 'string' ? candidate.trim() : ''
    if (model) return model
  }
  return ''
}

export function noConfiguredModelMessage(role: ConfiguredModelRole): string {
  return `No ${role} model is configured. Choose a ${role} model or a default model in Settings.`
}
