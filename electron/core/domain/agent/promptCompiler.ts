import {
  ModelFamily,
  FeatureModule,
  DEFAULT_FAMILY_PROMPTS,
  DEFAULT_CODING_PROMPT,
  CODING_TOOLS_BLOCK,
  detectModelFamily,
} from './promptPresets'
import type { AppSettings } from '../../../../src/types'

export type { ModelFamily, FeatureModule }

type FamilyBasedModule = Exclude<FeatureModule, 'coding'>

export class PromptCompiler {
  /**
   * Compiles and resolves the system prompt template for chat/translation/vision —
   * modules that still vary by model family (see DEFAULT_FAMILY_PROMPTS).
   * For the coding module, use compileCodingPrompt instead (family-agnostic).
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

    if (settings?.customPromptOverrides && settings.customPromptOverrides[module]) {
      template = settings.customPromptOverrides[module]
      isCustom = true
    } else if (settings?.customPromptOverrides && settings.customPromptOverrides[overrideKey]) {
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
   * Compiles the coding-agent system prompt. Family-agnostic and tier-free: the coding module
   * runs on the single configured `codingModel`, so there is one prompt. Custom overrides are
   * read from the "coding" key.
   *
   * When `toolCallingCapable` is true, the prose AVAILABLE AGENT TOOLS block
   * is omitted: the model already receives the structured tool schema via
   * the native `tools` API parameter (see ollamaToolSchemaCatalog.ts), so
   * repeating it in text would double-send the same schema (AGT2).
   */
  static compileCodingPrompt(
    variables: Record<string, string> = {},
    settings?: AppSettings,
    toolCallingCapable = false
  ): { prompt: string; isCustom: boolean } {
    const override = settings?.customPromptOverrides?.['coding']
    const isCustom = Boolean(override && override.trim())
    const template = isCustom ? (override as string) : DEFAULT_CODING_PROMPT

    const effectiveVariables = {
      ...variables,
      CODING_TOOLS_BLOCK: toolCallingCapable ? '' : CODING_TOOLS_BLOCK,
    }

    return {
      prompt: collapseBlankRuns(substituteVariables(template, effectiveVariables)),
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
   * Get default coding template, without variable substitution.
   */
  static getDefaultCodingTemplate(): string {
    return DEFAULT_CODING_PROMPT
  }
}

/**
 * Collapses runs of 3+ newlines to a single blank line. Placeholders that resolve to '' (most
 * often {CODING_TOOLS_BLOCK} on native tool-calling models) otherwise leave gaping holes in the
 * prompt, which is pure wasted context on a small window.
 */
function collapseBlankRuns(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n')
}

function substituteVariables(template: string, variables: Record<string, string>): string {
  let compiled = template
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{${key}}`
    compiled = compiled.replaceAll(placeholder, value !== undefined && value !== null ? String(value) : '')
  }
  return compiled
}
