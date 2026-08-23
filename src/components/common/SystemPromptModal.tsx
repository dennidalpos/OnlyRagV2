import React, { useState, useEffect, useRef } from 'react'
import { Modal } from './Modal'
import { AppSettings } from '../../types'
import {
  FeatureModule,
  ModelFamily,
  DEFAULT_FAMILY_PROMPTS,
  DEFAULT_CODING_PROMPT,
  detectModelFamily,
} from '../../constants/promptPresets'
import {
  Sliders,
  RotateCcw,
  Save,
  X,
  Sparkles,
  Check,
  Info,
  Copy,
  Plus,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { logger } from '../../lib/logger'

interface SystemPromptModalProps {
  isOpen: boolean
  onClose: () => void
  module: FeatureModule
  moduleTitle: string
  activeModelName?: string
  settings: AppSettings
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void
}

export interface PromptVariableMeta {
  name: string
  description: string
  required: boolean
}

export const MODULE_VARIABLES: Record<FeatureModule, PromptVariableMeta[]> = {
  coding: [
    { name: '{userTask}', description: "User's coding instruction / task", required: true },
    { name: '{workspacePath}', description: 'Absolute root path of active workspace', required: true },
    { name: '{agentMode}', description: 'Agent execution mode (plan, ask, agent)', required: true },
    { name: '{stepCount}', description: 'Current tool step sequence number', required: false },
    { name: '{MAX_STEPS}', description: 'Maximum tool call loop execution limit', required: false },
  ],
  chat: [
    { name: '{userMsgText}', description: "User's chat message", required: false },
    { name: '{contextStr}', description: 'Vector RAG context passages retrieved from docs', required: false },
  ],
  translation: [
    { name: '{sourceLang}', description: 'Source document language', required: true },
    { name: '{targetLang}', description: 'Target destination language', required: true },
    { name: '{chunkText}', description: 'Text chunk to be translated', required: true },
  ],
  vision: [
    { name: '{filename}', description: 'Source image / document filename', required: false },
    { name: '{currentPage}', description: 'Current active page number', required: false },
    { name: '{numPages}', description: 'Total document page count', required: false },
    { name: '{activePageContent}', description: 'OCR / extracted page text context', required: false },
  ],
}

type FamilyBasedModule = Exclude<FeatureModule, 'coding'>

/**
 * Effective prompt resolver for any module.
 * Prioritizes direct module custom override, then family-keyed custom override,
 * falling back to the canonical default prompt.
 */
export const getEffectivePrompt = (
  module: FeatureModule,
  activeModelName: string | undefined,
  settings: AppSettings
): { prompt: string; family: ModelFamily; isCustom: boolean } => {
  const selectedOverride = settings.selectedFamilyOverrides?.[module]
  const detectedFamily = detectModelFamily(activeModelName || '')

  const activeFamily: ModelFamily =
    selectedOverride && selectedOverride !== 'auto'
      ? (selectedOverride as ModelFamily)
      : detectedFamily

  // Check direct module override first
  const customModuleOverride = settings.customPromptOverrides?.[module]
  if (customModuleOverride && customModuleOverride.trim()) {
    return { prompt: customModuleOverride, family: activeFamily, isCustom: true }
  }

  // Check family-keyed override
  const overrideKey = `${module}:${activeFamily}`
  const customFamilyOverride = settings.customPromptOverrides?.[overrideKey]
  if (customFamilyOverride && customFamilyOverride.trim()) {
    return { prompt: customFamilyOverride, family: activeFamily, isCustom: true }
  }

  if (module === 'coding') {
    return { prompt: DEFAULT_CODING_PROMPT, family: activeFamily, isCustom: false }
  }

  const defaultPrompt =
    DEFAULT_FAMILY_PROMPTS[module as FamilyBasedModule]?.[activeFamily] ||
    DEFAULT_FAMILY_PROMPTS[module as FamilyBasedModule]?.generic ||
    ''

  return { prompt: defaultPrompt, family: activeFamily, isCustom: false }
}

export const compilePromptWithSampleVars = (
  rawTemplate: string,
  module: FeatureModule
): string => {
  const sampleVars: Record<FeatureModule, Record<string, string>> = {
    coding: {
      userTask: 'Implement secure JWT authentication and token refresh middleware',
      workspacePath: 'D:/Projects/OnlyRagWorkspace',
      agentMode: 'agent',
      stepCount: '1',
      MAX_STEPS: '50',
    },
    chat: {
      userMsgText: 'What are the main security guidelines for local tool execution?',
      contextStr: '[Doc: SecurityGuide.md]\nAll shell commands must run inside isolated workspace with path traversal checks.',
    },
    translation: {
      sourceLang: 'Italian',
      targetLang: 'English',
      chunkText: 'OnlyRag supporta modelli LLM locali con accelerazione hardware GPU e indicizzazione vettoriale LanceDB.',
    },
    vision: {
      filename: 'quarterly_report_2026.pdf',
      currentPage: '1',
      numPages: '8',
      activePageContent: '[Document Title: Q2 Financial Statement - Operating Margin: +24%]',
    },
  }

  const vars = sampleVars[module] || {}
  let compiled = rawTemplate
  for (const [key, value] of Object.entries(vars)) {
    compiled = compiled.replaceAll(`{${key}}`, value)
  }
  return compiled
}

export const SystemPromptModal: React.FC<SystemPromptModalProps> = ({
  isOpen,
  onClose,
  module,
  moduleTitle,
  activeModelName = '',
  settings,
  onUpdateSettings,
}) => {
  const { t } = useTranslation()
  const isCoding = module === 'coding'
  const detectedFamily = detectModelFamily(activeModelName)

  const [promptText, setPromptText] = useState<string>('')
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const getDefaultPrompt = (): string => {
    if (isCoding) {
      return DEFAULT_CODING_PROMPT
    }
    return (
      DEFAULT_FAMILY_PROMPTS[module as FamilyBasedModule]?.[detectedFamily] ||
      DEFAULT_FAMILY_PROMPTS[module as FamilyBasedModule]?.generic ||
      ''
    )
  }

  // Load current prompt on open or model/module changes
  useEffect(() => {
    if (isOpen) {
      const effective = getEffectivePrompt(module, activeModelName, settings)
      setPromptText(effective.prompt)
    }
  }, [isOpen, module, activeModelName, settings])

  // ESC key listener for accessibility

  if (!isOpen) return null

  const isCustomized = (() => {
    const customMod = settings.customPromptOverrides?.[module]
    const customKey = settings.customPromptOverrides?.[`${module}:${detectedFamily}`]
    return Boolean((customMod && customMod.trim()) || (customKey && customKey.trim()))
  })()

  const handleSavePrompt = () => {
    const updatedPromptOverrides = { ...(settings.customPromptOverrides || {}) }

    // Save under primary module key
    updatedPromptOverrides[module] = promptText

    // Coding has no family or tier variants: the single "coding" key above is the override.
    // Other modules still resolve per detected model family.
    if (!isCoding) {
      updatedPromptOverrides[`${module}:${detectedFamily}`] = promptText
    }

    onUpdateSettings({ customPromptOverrides: updatedPromptOverrides })
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 2500)
  }

  const handleResetToDefault = () => {
    const updatedPromptOverrides = { ...(settings.customPromptOverrides || {}) }
    delete updatedPromptOverrides[module]

    for (const key of Object.keys(updatedPromptOverrides)) {
      if (key.startsWith(`${module}:`)) {
        delete updatedPromptOverrides[key]
      }
    }

    const defaultPrompt = getDefaultPrompt()
    setPromptText(defaultPrompt)
    onUpdateSettings({ customPromptOverrides: updatedPromptOverrides })

    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 2500)
  }

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(promptText)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    } catch (err) {
      logger.error('SystemPromptModal', `Failed copying prompt to clipboard: ${(err as any)?.message || err}`)
    }
  }

  const handleInsertVariable = (varName: string) => {
    if (textareaRef.current) {
      const ta = textareaRef.current
      const start = ta.selectionStart || 0
      const end = ta.selectionEnd || 0
      const nextText = promptText.substring(0, start) + varName + promptText.substring(end)
      setPromptText(nextText)
      const caretPos = start + varName.length
      setTimeout(() => {
        ta.focus()
        ta.setSelectionRange(caretPos, caretPos)
      }, 0)
    } else {
      setPromptText((prev) => prev + (prev.endsWith(' ') || prev.endsWith('\n') ? '' : ' ') + varName)
    }
  }

  const moduleVars = MODULE_VARIABLES[module] || []
  const wordCount = promptText.trim() ? promptText.trim().split(/\s+/).length : 0

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      labelledById="system-prompt-modal-title"
      panelClassName="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
    >
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-sm">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 id="system-prompt-modal-title" className="text-base font-bold text-slate-100 flex items-center gap-2">
                {t('systemPrompt.title')} <span className="text-cyan-400">— {moduleTitle}</span>
              </h2>
              <p className="text-xs text-slate-400">
                {t('systemPrompt.subtitle')}
              </p>
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

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Active Model & Custom Status Bar */}
          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
              <span className="text-slate-400">{t('systemPrompt.activeModel')}:</span>
              <span className="font-mono text-slate-200 font-semibold">{activeModelName || t('common.none')}</span>
              {!isCoding && detectedFamily !== 'generic' && (
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-[10px]">
                  ({detectedFamily})
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 font-mono text-[11px]">
              {isCustomized ? (
                <span className="px-2 py-0.5 rounded-full bg-amber-950/80 text-amber-300 font-bold border border-amber-800/60">
                  {t('systemPrompt.customBadge')}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-slate-800/80 text-slate-400 font-medium border border-slate-700/60">
                  Standard
                </span>
              )}
              <span className="text-slate-500">•</span>
              <span className="text-slate-400">{promptText.length} caratteri ({wordCount} parole)</span>
            </div>
          </div>

          {/* System Prompt Textarea */}
          <div className="space-y-1.5 flex-1 flex flex-col">
            <textarea
              ref={textareaRef}
              id="system-prompt-editor-text"
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              rows={12}
              aria-label={t('systemPrompt.promptText')}
              className="w-full flex-1 min-h-[260px] bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-200 focus-ring resize-y leading-relaxed"
              placeholder={t('systemPrompt.systemPromptPlaceholder')}
            />
          </div>

          {/* Interactive Variable Insertion Chips */}
          <div className="p-3.5 rounded-xl bg-slate-950/40 border border-slate-800/80 text-[11px] space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-semibold text-slate-300">
                <Info className="w-3.5 h-3.5 text-cyan-400" />
                <span>{t('systemPrompt.variablesLegend')}</span>
              </div>
              <span className="text-[10px] text-slate-400">{t('systemPrompt.clickToInsert')}</span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {moduleVars.map((v) => {
                const isPresent = promptText.includes(v.name)
                return (
                  <button
                    key={v.name}
                    type="button"
                    onClick={() => handleInsertVariable(v.name)}
                    title={`${v.description} (${isPresent ? 'Presente nel prompt' : 'Clicca per inserire'})`}
                    className={`px-2 py-1 rounded-md font-mono text-[10px] flex items-center gap-1 transition-all border cursor-pointer ${
                      isPresent
                        ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800/60 hover:bg-emerald-900/50'
                        : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-cyan-500/40 hover:text-cyan-200'
                    }`}
                  >
                    {isPresent ? (
                      <Check className="w-2.5 h-2.5 text-emerald-400" />
                    ) : (
                      <Plus className="w-2.5 h-2.5 text-slate-400" />
                    )}
                    <span>{v.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleResetToDefault}
              className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-rose-400 hover:text-rose-300 text-xs font-medium rounded-xl transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
              title={t('common.reset')}
            >
              <RotateCcw className="w-3 h-3" />
              <span>Ripristina Predefinito</span>
            </button>

            <button
              type="button"
              onClick={handleCopyPrompt}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-slate-100 text-xs font-medium rounded-xl transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
              title={t('common.copy')}
            >
              {copySuccess ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400">{t('common.copied')}</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 text-slate-400" />
                  <span>{t('common.copy')}</span>
                </>
              )}
            </button>
          </div>

          <div className="flex items-center gap-2">
            {saveSuccess && (
              <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1" role="status" aria-live="polite">
                <Check className="w-4 h-4" /> {t('common.saved')}
              </span>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-medium rounded-xl transition-all cursor-pointer active:scale-95"
            >
              {t('common.close')}
            </button>

            <button
              type="button"
              onClick={handleSavePrompt}
              className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-semibold rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-cyan-950/50 active:scale-95 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5 fill-current" />
              <span>{t('systemPrompt.savePrompt')}</span>
            </button>
          </div>
        </div>
    </Modal>
  )
}
