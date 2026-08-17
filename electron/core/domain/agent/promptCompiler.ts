import {
  ModelFamily,
  FeatureModule,
  DEFAULT_FAMILY_PROMPTS,
  DEFAULT_CODING_TIER_PROMPTS,
  CODING_TOOLS_BLOCK,
  detectModelFamily,
} from './promptPresets'
import type { ComplexityTier } from './complexityEvaluator'
import type { AppSettings } from '../../../../src/types'

export type { ModelFamily, FeatureModule, ComplexityTier }

type FamilyBasedModule = Exclude<FeatureModule, 'coding'>

export class PromptCompiler {
  /**
   * Compiles and resolves the system prompt template for chat/translation/vision —
   * modules that still vary by model family (see DEFAULT_FAMILY_PROMPTS).
   * For the coding module, use compileCodingPrompt instead (family-agnostic,
   * scaled by complexity tier).
   */
  static compilePrompt(
    module: FamilyBasedModule,
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

    return {
      prompt: substituteVariables(template, variables),
      family: activeFamily,
      isCustom,
    }
  }

  /**
   * Compiles the coding-agent system prompt, family-agnostic and scaled by
   * complexity tier (fast/standard/deep_reasoning) instead of model family —
   * see DEFAULT_CODING_TIER_PROMPTS. Custom overrides are keyed by tier
   * ("coding:fast", "coding:standard", "coding:deep_reasoning") the same way
   * family-based modules key by family.
   *
   * When `toolCallingCapable` is true, the prose AVAILABLE AGENT TOOLS block
   * is omitted: the model already receives the structured tool schema via
   * the native `tools` API parameter (see ollamaToolSchemaCatalog.ts), so
   * repeating it in text would double-send the same schema (AGT2).
   */
  static compileCodingPrompt(
    tier: ComplexityTier,
    variables: Record<string, string> = {},
    settings?: AppSettings,
    toolCallingCapable = false
  ): { prompt: string; tier: ComplexityTier; isCustom: boolean } {
    const overrideKey = `coding:${tier}`

    let template = ''
    let isCustom = false

    if (settings?.customPromptOverrides && settings.customPromptOverrides[overrideKey]) {
      template = settings.customPromptOverrides[overrideKey]
      isCustom = true
    } else {
      template = DEFAULT_CODING_TIER_PROMPTS[tier] || DEFAULT_CODING_TIER_PROMPTS.standard
    }

    const effectiveVariables = {
      ...variables,
      CODING_TOOLS_BLOCK: toolCallingCapable ? '' : CODING_TOOLS_BLOCK,
    }

    return {
      prompt: substituteVariables(template, effectiveVariables).replace(/\n{3,}/g, '\n\n'),
      tier,
      isCustom,
    }
  }

  /**
   * Get default template for a given module and model family without variable substitution.
   */
  static getDefaultTemplate(module: FamilyBasedModule, family: ModelFamily): string {
    return DEFAULT_FAMILY_PROMPTS[module]?.[family] || DEFAULT_FAMILY_PROMPTS[module]?.generic || ''
  }

  /**
   * Get default coding template for a given complexity tier, without variable substitution.
   */
  static getDefaultCodingTemplate(tier: ComplexityTier): string {
    return DEFAULT_CODING_TIER_PROMPTS[tier] || DEFAULT_CODING_TIER_PROMPTS.standard
  }
}

function substituteVariables(template: string, variables: Record<string, string>): string {
  let compiled = template
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{${key}}`
    compiled = compiled.replaceAll(placeholder, value !== undefined && value !== null ? String(value) : '')
  }
  return compiled
}
