import React, { useState, useEffect, useMemo, useRef } from 'react'
import Editor from '@monaco-editor/react'
import {
  Bot,
  MessageSquare,
  Languages,
  Image as ImageIcon,
  Search,
  ChevronDown,
  ChevronRight,
  Save,
  Check,
  Info,
  AlertTriangle,
  RotateCcw,
  Plus,
  X,
  Sliders,
  type LucideIcon,
} from 'lucide-react'
import { Modal } from '../common/Modal'
import { InlineDestructiveConfirm } from '../common/InlineDestructiveConfirm'
import { AppSettings } from '../../types'
import {
  PROMPT_HIERARCHY,
  findPromptNode,
  resolveNodeTemplate,
  compilePromptWithSampleVars,
  validateNodeTemplate,
  hasBlockingIssues,
  type PromptNode,
  type PromptNodeId,
  type PromptIssue,
} from '../../constants/promptConfig'
// Offline capability signal. The authoritative check runs in the main process against Ollama's
// reported /api/tags capabilities; here it only drives an advisory notice, which is exactly the
// fallback role this helper documents.
import { supportsNativeToolCallingByFamily } from '../../../electron/core/domain/agent/ollamaToolCallingCapability'
import {
  ONLYRAG_MONACO_THEME_NAME,
  defineOnlyRagMonacoTheme,
  getStandardMonacoOptions,
} from '../../lib/monacoTheme'
import { estimateTokenCount } from '../../lib/tokenEstimate'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n'

interface PromptConfigurationModalProps {
  isOpen: boolean
  onClose: () => void
  settings: AppSettings
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void
  /** Node to open on: the views pass the one matching the section the user came from. */
  initialNodeId?: PromptNodeId
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Bot,
  MessageSquare,
  Languages,
  Image: ImageIcon,
}

/** The model each module actually runs on, for the capability notice. */
function activeModelForModule(module: string, settings: AppSettings): string {
  switch (module) {
    case 'coding':
      return settings.codingModel || settings.defaultModel || ''
    case 'chat':
      return settings.chatModel || settings.defaultModel || ''
    case 'translation':
      return settings.translationModel || settings.defaultModel || ''
    case 'images':
      return settings.visionModel || settings.defaultModel || ''
    default:
      return settings.defaultModel || ''
  }
}

export const PromptConfigurationModal: React.FC<PromptConfigurationModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  initialNodeId = 'coding:master',
}) => {
  const { t } = useTranslation()

  const [selectedNodeId, setSelectedNodeId] = useState<PromptNodeId>(initialNodeId)
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [savedFlash, setSavedFlash] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const editorRef = useRef<any>(null)

  const selectedNode = findPromptNode(selectedNodeId)

  useEffect(() => {
    if (isOpen) setSelectedNodeId(initialNodeId)
  }, [isOpen, initialNodeId])

  useEffect(() => {
    if (!isOpen) return
    setDraft(resolveNodeTemplate(selectedNodeId, settings).template)
    setTab('edit')
  }, [isOpen, selectedNodeId, settings])

  const isOverridden = (nodeId: PromptNodeId): boolean =>
    Boolean(settings.customPromptOverrides?.[nodeId]?.trim())

  const issues: PromptIssue[] = useMemo(
    () => (selectedNode ? validateNodeTemplate(selectedNodeId, draft) : []),
    [selectedNodeId, draft, selectedNode]
  )
  const blocked = hasBlockingIssues(issues)

  const isDirty = selectedNode ? draft !== resolveNodeTemplate(selectedNodeId, settings).template : false

  const tokenLabel = t('promptConfig.tokenCount', {
    tokens: estimateTokenCount(draft),
    chars: draft.length,
  })

  const capabilityOmitted = useMemo(() => {
    if (!selectedNode?.omittedWhenCapability) return false
    const model = activeModelForModule(selectedNode.module, settings)
    return selectedNode.omittedWhenCapability === 'tools' && supportsNativeToolCallingByFamily(model)
  }, [selectedNode, settings])

  const preview = useMemo(
    () => (tab === 'preview' ? compilePromptWithSampleVars(draft, selectedNodeId) : ''),
    [tab, draft, selectedNodeId]
  )

  const visibleCategories = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return PROMPT_HIERARCHY
    return PROMPT_HIERARCHY.map((category) => ({
      ...category,
      nodes: category.nodes.filter((node) => {
        const label = t(node.labelKey as TranslationKey) || node.label
        return (
          label.toLowerCase().includes(needle) ||
          node.id.toLowerCase().includes(needle) ||
          node.defaultValue.toLowerCase().includes(needle)
        )
      }),
    })).filter((category) => category.nodes.length > 0)
  }, [search, t])

  if (!isOpen) return null

  const handleSave = () => {
    if (blocked || !selectedNode) return
    const overrides = { ...(settings.customPromptOverrides || {}) }
    overrides[selectedNodeId] = draft
    onUpdateSettings({ customPromptOverrides: overrides })
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 2000)
  }

  const handleReset = () => {
    if (!selectedNode) return
    const overrides = { ...(settings.customPromptOverrides || {}) }
    delete overrides[selectedNodeId]
    onUpdateSettings({ customPromptOverrides: overrides })
    setDraft(selectedNode.defaultValue)
  }

  const handleInsertVariable = (token: string) => {
    const editor = editorRef.current
    if (editor) {
      const selection = editor.getSelection()
      editor.executeEdits('insert-variable', [{ range: selection, text: token, forceMoveMarkers: true }])
      editor.focus()
      return
    }
    setDraft((prev) => `${prev}${prev.endsWith(' ') || prev.endsWith('\n') || !prev ? '' : ' '}${token}`)
  }

  const issueMessage = (issue: PromptIssue): string => {
    const key: Record<PromptIssue['code'], string> = {
      syntax: 'promptConfig.issueSyntax',
      empty: 'promptConfig.issueEmpty',
      'missing-partial': 'promptConfig.issueMissingPartial',
      'duplicate-partial': 'promptConfig.issueDuplicatePartial',
      'unknown-variable': 'promptConfig.issueUnknownVariable',
    }
    const translated = t(key[issue.code] as TranslationKey, { token: issue.tokenName || '' })
    return translated.includes('promptConfig.') ? issue.message : translated
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      labelledById="prompt-config-modal-title"
      panelClassName="w-[94vw] max-w-6xl h-[88vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
    >
      <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <h2 id="prompt-config-modal-title" className="text-base font-bold text-slate-100">
              {t('promptConfig.title')}
            </h2>
            <p className="text-xs text-slate-400">{t('promptConfig.subtitle')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="p-2 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-xl transition-colors focus-ring active:scale-95 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Tree */}
        <aside className="w-72 shrink-0 border-r border-slate-800 bg-slate-950/40 flex flex-col">
          <div className="p-3 border-b border-slate-800/80">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('promptConfig.searchPlaceholder')}
                className="w-full bg-slate-900 border border-slate-700/70 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus-ring"
              />
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto p-2 space-y-1">
            {visibleCategories.map((category) => {
              const Icon = CATEGORY_ICONS[category.icon] || Bot
              const isCollapsed = collapsed[category.id]
              return (
                <div key={category.id}>
                  <button
                    type="button"
                    onClick={() => setCollapsed((prev) => ({ ...prev, [category.id]: !prev[category.id] }))}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800/60 transition-colors focus-ring cursor-pointer"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                    )}
                    <Icon className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{t(category.labelKey as TranslationKey) || category.label}</span>
                  </button>

                  {!isCollapsed && (
                    <ul className="mt-0.5 mb-1 space-y-0.5">
                      {category.nodes.map((node: PromptNode) => {
                        const active = node.id === selectedNodeId
                        const modified = isOverridden(node.id)
                        return (
                          <li key={node.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedNodeId(node.id)}
                              className={`w-full text-left pl-9 pr-2 py-1.5 rounded-lg text-xs transition-colors focus-ring cursor-pointer flex items-center justify-between gap-2 ${
                                active
                                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40'
                                  : 'text-slate-400 hover:bg-slate-800/60 border border-transparent'
                              }`}
                            >
                              <span className="truncate">{t(node.labelKey as TranslationKey) || node.label}</span>
                              <span
                                className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] border ${
                                  modified
                                    ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                                    : 'bg-slate-800/80 text-slate-500 border-slate-700/60'
                                }`}
                              >
                                {modified ? t('promptConfig.customBadge') : t('promptConfig.defaultBadge')}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )
            })}
          </nav>
        </aside>

        {/* Editor */}
        <section className="flex-1 flex flex-col min-w-0">
          {selectedNode && (
            <>
              <div className="px-5 py-3 border-b border-slate-800 flex items-start justify-between gap-4 shrink-0">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-100 truncate">
                    {t(selectedNode.labelKey as TranslationKey) || selectedNode.label}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">{t(selectedNode.descriptionKey as TranslationKey)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] text-slate-500 font-mono">{tokenLabel}</span>
                  <div className="flex rounded-lg border border-slate-700/70 overflow-hidden">
                    {(['edit', 'preview'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setTab(mode)}
                        className={`px-3 py-1 text-[11px] transition-colors cursor-pointer ${
                          tab === mode ? 'bg-cyan-500/15 text-cyan-300' : 'text-slate-400 hover:bg-slate-800/60'
                        }`}
                      >
                        {mode === 'edit' ? t('promptConfig.editTab') : t('promptConfig.previewTab')}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {capabilityOmitted && (
                <div className="mx-5 mt-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 flex gap-2 text-[11px] text-amber-200 shrink-0">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{t('promptConfig.capabilityOmitted')}</span>
                </div>
              )}

              <div className="flex-1 min-h-0 m-5 rounded-xl border border-slate-800 overflow-hidden bg-[#080c14]">
                <Editor
                  height="100%"
                  theme={ONLYRAG_MONACO_THEME_NAME}
                  beforeMount={defineOnlyRagMonacoTheme}
                  language="markdown"
                  value={tab === 'edit' ? draft : preview}
                  onChange={(value) => tab === 'edit' && setDraft(value || '')}
                  onMount={(editor) => {
                    editorRef.current = editor
                  }}
                  options={getStandardMonacoOptions({
                    readOnly: tab === 'preview',
                    wordWrap: true,
                    minimap: false,
                  })}
                />
              </div>

              {selectedNode.variables.length > 0 && tab === 'edit' && (
                <div className="px-5 pb-3 shrink-0">
                  <p className="text-[11px] text-slate-500 mb-1.5">
                    {t('promptConfig.variablesLegend')}{' '}
                    <span className="text-slate-600">({t('promptConfig.clickToInsert')})</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedNode.variables.map((variable) => (
                      <button
                        key={variable.name}
                        type="button"
                        title={variable.description}
                        onClick={() => handleInsertVariable(`{{${variable.name}}}`)}
                        className="px-2 py-0.5 rounded-md bg-slate-800/80 border border-slate-700/60 text-[11px] font-mono text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300 transition-colors focus-ring cursor-pointer flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        {`{{${variable.name}}}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {issues.length > 0 && (
                <div className="px-5 pb-3 space-y-1 shrink-0">
                  {issues.map((issue, index) => (
                    <div
                      key={`${issue.code}-${issue.tokenName || index}`}
                      className={`flex gap-2 text-[11px] p-2 rounded-lg border ${
                        issue.severity === 'error'
                          ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                          : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                      }`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{issueMessage(issue)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/50 flex items-center justify-between gap-3 shrink-0">
                {isOverridden(selectedNodeId) ? (
                  <InlineDestructiveConfirm
                    onConfirm={handleReset}
                    icon={RotateCcw}
                    actionLabel={t('promptConfig.resetNode')}
                    itemLabel={t(selectedNode.labelKey as TranslationKey) || selectedNode.label}
                    hint={t('promptConfig.resetNodeConfirm')}
                    iconClassName="w-4 h-4"
                  />
                ) : (
                  <span className="text-[11px] text-slate-600">{t('promptConfig.defaultBadge')}</span>
                )}

                <div className="flex items-center gap-2">
                  {blocked && <span className="text-[11px] text-rose-300">{t('promptConfig.saveBlocked')}</span>}
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={blocked || !isDirty}
                    className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all focus-ring cursor-pointer flex items-center gap-1.5 active:scale-95"
                  >
                    {savedFlash ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                    {savedFlash ? t('promptConfig.saved') : t('promptConfig.savePrompt')}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </Modal>
  )
}
