import {
  FeatureModule,
  CODING_TOOLS_BLOCK,
  CODING_CORE_DIRECTIVES,
  DEFAULT_CODING_PROMPT,
  DEFAULT_CHAT_PROMPT,
  DEFAULT_TRANSLATION_PROMPT,
  DEFAULT_IMAGE_ANALYSIS_PROMPT,
} from './promptPresets'

/**
 * The configuration tree: every system prompt the user can edit, and nothing else.
 *
 * Six leaf nodes, down from the 87 the per-family matrix implied. A node id doubles as its
 * override key in `AppSettings.customPromptOverrides`, so there is exactly one key per editable
 * text — no module-wide/family-keyed pair that can shadow one another.
 */

export type PromptNodeId =
  | 'coding:master'
  | 'coding:directives'
  | 'coding:tools'
  | 'chat'
  | 'translation'
  | 'images:analysis'

/** Capabilities Ollama reports per model via /api/tags. */
export type OllamaCapability = 'tools' | 'vision' | 'completion' | 'insert' | 'embedding'

export interface PromptVariableMeta {
  /** Mustache name, without braces. */
  name: string
  description: string
  /** Sample value used by the modal's compiled-preview pane. */
  sample: string
}

export interface PromptNode {
  id: PromptNodeId
  module: FeatureModule
  labelKey: string
  descriptionKey: string
  /** English fallback, used when a locale is missing the key. */
  label: string
  defaultValue: string
  variables: PromptVariableMeta[]
  /**
   * Name this node is exposed under when a parent template references it as `{{> name}}`.
   * Only child nodes have one.
   */
  partialName?: string
  /**
   * Partials the template must still reference. Dropping `{{> directives}}` from the coding
   * master silently strips the anti-loop and DoD rules, so the validator treats it as an error
   * rather than a preference.
   */
  requiredPartials?: string[]
  /**
   * When the active model reports this capability, the node is omitted from the compiled prompt
   * and its editor is read-only. `tools` is the AGT2 gate: the schema already goes out via the
   * native `tools` API parameter, so sending it as prose too would double it.
   */
  omittedWhenCapability?: OllamaCapability
  /**
   * Set when nothing in the app currently sends this prompt to a model. Editing it is stored and
   * preserved, but has no runtime effect yet — the modal says so instead of implying otherwise.
   */
}

export interface PromptCategory {
  id: string
  labelKey: string
  label: string
  /** Lucide icon name, resolved by the modal. */
  icon: string
  nodes: PromptNode[]
}

const CODING_VARIABLES: PromptVariableMeta[] = [
  { name: 'agentMode', description: 'Agent execution mode (plan, ask, agent)', sample: 'AGENT' },
  {
    name: 'userTask',
    description: "The user's coding instruction for this run",
    sample: '[User instruction / task prompt entered in the chat]',
  },
  { name: 'workspacePath', description: 'Absolute root path of the active workspace', sample: '[workspace path]' },
  { name: 'currentDate', description: 'Current date, injected each turn', sample: '2026-08-24 (Monday, August 24, 2026)' },
]

export const PROMPT_HIERARCHY: PromptCategory[] = [
  {
    id: 'coding',
    labelKey: 'promptConfig.categoryCoding',
    label: 'Coding Agent',
    icon: 'Bot',
    nodes: [
      {
        id: 'coding:master',
        module: 'coding',
        labelKey: 'promptConfig.nodeCodingMaster',
        descriptionKey: 'promptConfig.nodeCodingMasterDesc',
        label: 'Master Template',
        defaultValue: DEFAULT_CODING_PROMPT,
        variables: CODING_VARIABLES,
        requiredPartials: ['directives', 'tools'],
      },
      {
        id: 'coding:directives',
        module: 'coding',
        labelKey: 'promptConfig.nodeCodingDirectives',
        descriptionKey: 'promptConfig.nodeCodingDirectivesDesc',
        label: 'Core Directives',
        defaultValue: CODING_CORE_DIRECTIVES,
        variables: CODING_VARIABLES.filter((v) => v.name === 'workspacePath'),
        partialName: 'directives',
      },
      {
        id: 'coding:tools',
        module: 'coding',
        labelKey: 'promptConfig.nodeCodingTools',
        descriptionKey: 'promptConfig.nodeCodingToolsDesc',
        label: 'Tool Schema Block',
        defaultValue: CODING_TOOLS_BLOCK,
        variables: [],
        partialName: 'tools',
        omittedWhenCapability: 'tools',
      },
    ],
  },
  {
    id: 'chat',
    labelKey: 'promptConfig.categoryChat',
    label: 'RAG Chat',
    icon: 'MessageSquare',
    nodes: [
      {
        id: 'chat',
        module: 'chat',
        labelKey: 'promptConfig.nodeChat',
        descriptionKey: 'promptConfig.nodeChatDesc',
        label: 'RAG Chat',
        defaultValue: DEFAULT_CHAT_PROMPT,
        variables: [],
      },
    ],
  },
  {
    id: 'translation',
    labelKey: 'promptConfig.categoryTranslation',
    label: 'Translation',
    icon: 'Languages',
    nodes: [
      {
        id: 'translation',
        module: 'translation',
        labelKey: 'promptConfig.nodeTranslation',
        descriptionKey: 'promptConfig.nodeTranslationDesc',
        label: 'Document Translation',
        defaultValue: DEFAULT_TRANSLATION_PROMPT,
        variables: [
          { name: 'sourceLang', description: 'Source document language', sample: '[Source language, e.g. Italian]' },
          { name: 'targetLang', description: 'Target document language', sample: '[Target language, e.g. English]' },
        ],
      },
    ],
  },
  {
    id: 'images',
    labelKey: 'promptConfig.categoryImages',
    label: 'Images',
    icon: 'Image',
    nodes: [
      {
        id: 'images:analysis',
        module: 'images',
        labelKey: 'promptConfig.nodeImageAnalysis',
        descriptionKey: 'promptConfig.nodeImageAnalysisDesc',
        label: 'Visual Analysis & OCR',
        defaultValue: DEFAULT_IMAGE_ANALYSIS_PROMPT,
        variables: [
          { name: 'filename', description: 'Source document filename', sample: '[Document filename, e.g. report.pdf]' },
          { name: 'currentPage', description: 'Page currently being inspected', sample: '1' },
          { name: 'numPages', description: 'Total page count of the document', sample: '10' },
          {
            name: 'activePageContent',
            description: 'Text already extracted from the page',
            sample: '[Extracted text / layout content of the active page]',
          },
        ],
      },
    ],
  },
]

export const ALL_PROMPT_NODES: PromptNode[] = PROMPT_HIERARCHY.flatMap((c) => c.nodes)

export const PROMPT_NODE_IDS: PromptNodeId[] = ALL_PROMPT_NODES.map((n) => n.id)

export function findPromptNode(id: string): PromptNode | undefined {
  return ALL_PROMPT_NODES.find((n) => n.id === id)
}

/** Child nodes of a module, keyed by the partial name their parent references. */
export function partialNodesForModule(module: FeatureModule): PromptNode[] {
  return ALL_PROMPT_NODES.filter((n) => n.module === module && Boolean(n.partialName))
}

/** The node a module compiles from — the one without a partialName. */
export function rootNodeForModule(module: FeatureModule): PromptNode | undefined {
  return ALL_PROMPT_NODES.find((n) => n.module === module && !n.partialName)
}
