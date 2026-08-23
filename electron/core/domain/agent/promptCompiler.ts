import type { FeatureModule } from './promptPresets'
import type { AppSettings } from '../../../../src/types'
import {
  PROMPT_HIERARCHY,
  findPromptNode,
  partialNodesForModule,
  rootNodeForModule,
  type PromptNode,
  type PromptNodeId,
} from './promptHierarchyRegistry'
import { renderPromptTemplate, collapseBlankRuns } from './promptTemplateEngine'

export type { FeatureModule }

export interface CompileOptions {
  /** Values for the template's `{{variables}}`. */
  variables?: Record<string, unknown>
  settings?: AppSettings
  /**
   * Capabilities the active model reports to Ollama (`/api/tags` -> ["completion","tools"]).
   * This is the only thing prompt assembly adapts to: there is no per-model-family branching.
   */
  capabilities?: readonly string[]
}

export interface CompiledPrompt {
  prompt: string
  /** True when any node contributing to this prompt carries a user override. */
  isCustom: boolean
}

/**
 * Resolves one node's template: the user's override when present and non-empty, otherwise the
 * factory default. One key per node, so nothing can shadow anything else.
 */
export function resolveNodeTemplate(
  nodeId: PromptNodeId,
  settings?: AppSettings
): { template: string; isCustom: boolean } {
  const node = findPromptNode(nodeId)
  if (!node) return { template: '', isCustom: false }

  const override = settings?.customPromptOverrides?.[nodeId]
  if (override && override.trim()) return { template: override, isCustom: true }

  return { template: node.defaultValue, isCustom: false }
}

function isOmitted(node: PromptNode, capabilities: readonly string[]): boolean {
  return Boolean(node.omittedWhenCapability && capabilities.includes(node.omittedWhenCapability))
}

export class PromptCompiler {
  /**
   * Compiles a module's system prompt from its root node plus whichever child nodes the template
   * still references as partials.
   */
  static compileModulePrompt(module: FeatureModule, options: CompileOptions = {}): CompiledPrompt {
    const { variables = {}, settings, capabilities = [] } = options

    const root = rootNodeForModule(module)
    if (!root) return { prompt: '', isCustom: false }

    const resolvedRoot = resolveNodeTemplate(root.id, settings)
    let isCustom = resolvedRoot.isCustom

    const partials: Record<string, string> = {}
    for (const child of partialNodesForModule(module)) {
      if (isOmitted(child, capabilities)) {
        // AGT2: the schema is already on the wire via the native `tools` parameter.
        partials[child.partialName as string] = ''
        continue
      }
      const resolvedChild = resolveNodeTemplate(child.id, settings)
      partials[child.partialName as string] = resolvedChild.template
      isCustom = isCustom || resolvedChild.isCustom
    }

    const view: Record<string, unknown> = {
      ...variables,
      nativeToolCalling: capabilities.includes('tools'),
      nativeVision: capabilities.includes('vision'),
    }

    const prompt = collapseBlankRuns(renderPromptTemplate(resolvedRoot.template, view, partials)).trim()
    return { prompt, isCustom }
  }

  /**
   * Coding-agent entrypoint. Kept as a named method because the turn assembler calls it on every
   * step and passes the capability as a boolean it already computed.
   */
  static compileCodingPrompt(
    variables: Record<string, unknown> = {},
    settings?: AppSettings,
    toolCallingCapable = false
  ): CompiledPrompt {
    return PromptCompiler.compileModulePrompt('coding', {
      variables,
      settings,
      capabilities: toolCallingCapable ? ['tools'] : [],
    })
  }

  /** Factory default for a node, with no variable substitution. */
  static getDefaultTemplate(nodeId: PromptNodeId): string {
    return findPromptNode(nodeId)?.defaultValue ?? ''
  }
}

/**
 * The prompt a module will actually send, given current settings.
 *
 * Model name is deliberately NOT a parameter: prompts no longer vary by model family. Callers that
 * need capability-driven adaptation pass `capabilities`.
 */
export function getEffectivePrompt(
  module: FeatureModule,
  settings?: AppSettings,
  options: Omit<CompileOptions, 'settings'> = {}
): CompiledPrompt {
  return PromptCompiler.compileModulePrompt(module, { ...options, settings })
}

/**
 * Renders a template with the registry's sample values, for the modal's preview pane.
 * Never used on the wire.
 */
export function compilePromptWithSampleVars(
  rawTemplate: string,
  nodeId: PromptNodeId,
  settings?: AppSettings
): string {
  const node = findPromptNode(nodeId)
  if (!node) return rawTemplate

  const samples: Record<string, string> = {}
  for (const variable of node.variables) samples[variable.name] = variable.sample

  const partials: Record<string, string> = {}
  for (const child of partialNodesForModule(node.module)) {
    const override = settings?.customPromptOverrides?.[child.id]
    partials[child.partialName as string] = (override && override.trim()) ? override : child.defaultValue
  }

  const view: Record<string, unknown> = {
    ...samples,
    nativeToolCalling: false,
    nativeVision: true,
  }

  try {
    return collapseBlankRuns(renderPromptTemplate(rawTemplate, view, partials)).trim()
  } catch {
    // A half-typed template is the normal state of a live editor; show the raw text instead of
    // blanking the preview pane.
    return rawTemplate
  }
}

export { PROMPT_HIERARCHY, findPromptNode }
export type { PromptNode, PromptNodeId }
