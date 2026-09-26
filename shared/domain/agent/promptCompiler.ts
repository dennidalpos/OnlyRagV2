import type { FeatureModule } from './promptPresets'
import type { AppSettings } from '../../types'
import { PROMPT_HIERARCHY, findPromptNode, partialNodesForModule, rootNodeForModule, type PromptNode, type PromptNodeId } from './promptHierarchyRegistry'
import { renderPromptTemplate, collapseBlankRuns } from './promptTemplateEngine'
import { DEFAULT_APP_SETTINGS } from '../settings/appSettingsDefaults'

export type { FeatureModule }

export interface CompileOptions {
  /** Values for the template's `{{variables}}`. */
  variables?: Record<string, unknown>
  settings?: AppSettings
  /** Capabilities reported by the model (e.g. ['completion', 'vision']). */
  capabilities?: readonly string[]
}

export interface CompiledPrompt {
  prompt: string
  /** True when any node contributing to this prompt carries a user override. */
  isCustom: boolean
}

/** Resolves node template: returns custom override if set, otherwise default. */
export function resolveNodeTemplate(nodeId: PromptNodeId, settings?: AppSettings): { template: string; isCustom: boolean } {
  const node = findPromptNode(nodeId)
  if (!node) return { template: '', isCustom: false }

  const override = settings?.customPromptOverrides?.[nodeId]
  if (override && override.trim()) return { template: override, isCustom: true }

  return { template: node.defaultValue, isCustom: false }
}

export class PromptCompiler {
  /** Compiles a module system prompt from root and referenced partial nodes. */
  static compileModulePrompt(module: FeatureModule, options: CompileOptions = {}): CompiledPrompt {
    const { variables = {}, settings, capabilities = [] } = options

    const root = rootNodeForModule(module)
    if (!root) return { prompt: '', isCustom: false }

    const resolvedRoot = resolveNodeTemplate(root.id, settings)
    let isCustom = resolvedRoot.isCustom

    const partials: Record<string, string> = {}
    for (const child of partialNodesForModule(module)) {
      const resolvedChild = resolveNodeTemplate(child.id, settings)
      partials[child.partialName as string] = resolvedChild.template
      isCustom = isCustom || resolvedChild.isCustom
    }

    const policy = (settings ?? DEFAULT_APP_SETTINGS).capabilityPolicyMode
    const view: Record<string, unknown> = {
      ...variables,
      // Every model speaks native tool calls now; custom templates written with {{^nativeToolCalling}}
      // sections for the retired text protocol keep rendering their native variant.
      nativeToolCalling: true,
      nativeVision: capabilities.includes('vision'),
      // Rules may only name tools the capability policy lets the run use (see turnToolPolicy.ts).
      webResearch: policy === 'network-approved',
      browserPreview: policy !== 'offline-strict',
    }

    const prompt = collapseBlankRuns(renderPromptTemplate(resolvedRoot.template, view, partials)).trim()
    return { prompt, isCustom }
  }

  /** Compiles coding agent prompt. The tool catalogue travels as the request's native `tools` array. */
  static compileCodingPrompt(variables: Record<string, unknown> = {}, settings?: AppSettings): CompiledPrompt {
    return PromptCompiler.compileModulePrompt('coding', { variables, settings })
  }

  /** Factory default for a node, with no variable substitution. */
  static getDefaultTemplate(nodeId: PromptNodeId): string {
    return findPromptNode(nodeId)?.defaultValue ?? ''
  }
}

/** The prompt a module will actually send, given current settings. */
export function getEffectivePrompt(module: FeatureModule, settings?: AppSettings, options: Omit<CompileOptions, 'settings'> = {}): CompiledPrompt {
  return PromptCompiler.compileModulePrompt(module, { ...options, settings })
}

/** Renders a template with sample/context values for preview. */
export function compilePromptWithSampleVars(
  rawTemplate: string,
  nodeId: PromptNodeId,
  settings?: AppSettings,
  contextOverrides?: {
    workspacePath?: string | null
    isStandaloneMode?: boolean
    currentDate?: string
    agentMode?: string
    userTask?: string
    sourceLang?: string
    targetLang?: string
    filename?: string
    currentPage?: string
    numPages?: string
    activePageContent?: string
  },
): string {
  const node = findPromptNode(nodeId)
  if (!node) return rawTemplate

  const now = new Date()
  const formattedDate = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const dynamicCurrentDate = `${now.toISOString().split('T')[0]} (${formattedDate})`

  const resolvedWorkspacePath = contextOverrides?.isStandaloneMode
    ? 'Standalone (No Workspace)'
    : contextOverrides?.workspacePath || (typeof window !== 'undefined' ? localStorage.getItem('onlyrag_last_workspace_path') : null) || '[workspace path]'

  const samples: Record<string, string> = {}
  for (const variable of node.variables) {
    if (variable.name === 'currentDate') {
      samples.currentDate = contextOverrides?.currentDate || dynamicCurrentDate
    } else if (variable.name === 'workspacePath') {
      samples.workspacePath = resolvedWorkspacePath
    } else if (variable.name === 'agentMode') {
      samples.agentMode = (contextOverrides?.agentMode || 'GUIDED').toUpperCase()
    } else if (variable.name === 'userTask') {
      samples.userTask = contextOverrides?.userTask || variable.sample || '[User instruction / task prompt entered in the chat]'
    } else if (variable.name === 'sourceLang') {
      samples.sourceLang = contextOverrides?.sourceLang || variable.sample || '[Source language, e.g. Italian]'
    } else if (variable.name === 'targetLang') {
      samples.targetLang = contextOverrides?.targetLang || variable.sample || '[Target language, e.g. English]'
    } else if (variable.name === 'filename') {
      samples.filename = contextOverrides?.filename || variable.sample || '[Document filename, e.g. report.pdf]'
    } else if (variable.name === 'currentPage') {
      samples.currentPage = contextOverrides?.currentPage || variable.sample || '1'
    } else if (variable.name === 'numPages') {
      samples.numPages = contextOverrides?.numPages || variable.sample || '10'
    } else if (variable.name === 'activePageContent') {
      samples.activePageContent = contextOverrides?.activePageContent || variable.sample || '[Extracted text / layout content of the active page]'
    } else {
      samples[variable.name] = variable.sample
    }
  }

  const partials: Record<string, string> = {}
  for (const child of partialNodesForModule(node.module)) {
    const override = settings?.customPromptOverrides?.[child.id]
    partials[child.partialName as string] = override && override.trim() ? override : child.defaultValue
  }

  const view: Record<string, unknown> = {
    ...samples,
    nativeToolCalling: true,
    nativeVision: true,
    webResearch: true,
    browserPreview: true,
  }

  try {
    return collapseBlankRuns(renderPromptTemplate(rawTemplate, view, partials)).trim()
  } catch {
    // Fall back to raw template during live editing syntax errors
    return rawTemplate
  }
}

export { PROMPT_HIERARCHY, findPromptNode }
export type { PromptNode, PromptNodeId }
