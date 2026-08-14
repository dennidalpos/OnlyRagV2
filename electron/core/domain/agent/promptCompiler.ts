import {
  ModelFamily,
  FeatureModule,
  DEFAULT_FAMILY_PROMPTS,
  detectModelFamily,
} from '../../../../src/constants/promptPresets'
import type { AppSettings } from '../../../../src/types'

export type { ModelFamily, FeatureModule }

export class PromptCompiler {
  /**
   * Compiles and resolves system prompt template for a specific feature module and model family.
   */
  static compilePrompt(
    module: FeatureModule,
    modelName: string,
    variables: Record<string, string> = {},
    settings?: AppSettings
  ): { prompt: string; family: ModelFamily; isCustom: boolean } {
    const selectedOverride = settings?.selectedFamilyOverrides?.[module]
    const detectedFamily = detectModelFamily(modelName)
    const activeFamily: ModelFamily =
      selectedOverride && selectedOverride !== 'auto'
        ? (selectedOverride as ModelFamily)
        : detectedFamily

    const overrideKey = `${module}:${activeFamily}`

    let template = ''
    let isCustom = false

    if (settings?.customPromptOverrides && settings.customPromptOverrides[overrideKey]) {
      template = settings.customPromptOverrides[overrideKey]
      isCustom = true
    } else {
      template = DEFAULT_FAMILY_PROMPTS[module]?.[activeFamily] || DEFAULT_FAMILY_PROMPTS[module]?.generic || ''
    }

    let compiled = template
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{${key}}`
      compiled = compiled.replaceAll(placeholder, value !== undefined && value !== null ? String(value) : '')
    }

    return {
      prompt: compiled,
      family: activeFamily,
      isCustom,
    }
  }

  /**
   * Get default template for a given module and model family without variable substitution.
   */
  static getDefaultTemplate(module: FeatureModule, family: ModelFamily): string {
    return DEFAULT_FAMILY_PROMPTS[module]?.[family] || DEFAULT_FAMILY_PROMPTS[module]?.generic || ''
  }
}
