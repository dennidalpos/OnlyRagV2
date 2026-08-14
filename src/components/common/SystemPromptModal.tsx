import React, { useState, useEffect } from 'react'
import { AppSettings } from '../../types'
import {
  FeatureModule,
  ModelFamily,
  MODEL_FAMILIES,
  DEFAULT_FAMILY_PROMPTS,
  detectModelFamily,
} from '../../constants/promptPresets'
import { Sliders, RotateCcw, Save, X, Sparkles, Check, Info, Copy } from 'lucide-react'
import { useTranslation } from '../../i18n'

interface SystemPromptModalProps {
  isOpen: boolean
  onClose: () => void
  module: FeatureModule
  moduleTitle: string
  activeModelName?: string
  settings: AppSettings
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void
}

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

  const overrideKey = `${module}:${activeFamily}`
  const customOverride = settings.customPromptOverrides?.[overrideKey]

  if (customOverride && customOverride.trim()) {
    return { prompt: customOverride, family: activeFamily, isCustom: true }
  }

  const defaultPrompt =
    DEFAULT_FAMILY_PROMPTS[module]?.[activeFamily] ||
    DEFAULT_FAMILY_PROMPTS[module]?.generic ||
    ''

  return { prompt: defaultPrompt, family: activeFamily, isCustom: false }
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
  const detectedFamily = detectModelFamily(activeModelName)
  const currentOverrideFamily = settings.selectedFamilyOverrides?.[module] || 'auto'

  const [selectedFamily, setSelectedFamily] = useState<ModelFamily | 'auto'>(currentOverrideFamily as any)
  const effectiveFamily: ModelFamily = selectedFamily === 'auto' ? detectedFamily : selectedFamily

  const [promptText, setPromptText] = useState<string>('')
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)

  // Sync state when modal opens or model/family/module changes
  useEffect(() => {
    if (isOpen) {
      const curFam = (settings.selectedFamilyOverrides?.[module] || 'auto') as ModelFamily | 'auto'
      setSelectedFamily(curFam)
      const activeFam = curFam === 'auto' ? detectedFamily : curFam
      const overrideKey = `${module}:${activeFam}`
      const customVal = settings.customPromptOverrides?.[overrideKey]
      if (customVal !== undefined) {
        setPromptText(customVal)
      } else {
        const factoryVal = DEFAULT_FAMILY_PROMPTS[module]?.[activeFam] || DEFAULT_FAMILY_PROMPTS[module]?.generic || ''
        setPromptText(factoryVal)
      }
    }
  }, [isOpen, module, activeModelName, settings])

  // ESC Key Listener for Accessibility
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleFamilyChange = (fam: string) => {
    const newFam = fam as ModelFamily | 'auto'
    setSelectedFamily(newFam)
    const targetFamily: ModelFamily = newFam === 'auto' ? detectedFamily : newFam
    const overrideKey = `${module}:${targetFamily}`
    const customVal = settings.customPromptOverrides?.[overrideKey]
    if (customVal !== undefined) {
      setPromptText(customVal)
    } else {
      const factoryVal = DEFAULT_FAMILY_PROMPTS[module]?.[targetFamily] || DEFAULT_FAMILY_PROMPTS[module]?.generic || ''
      setPromptText(factoryVal)
    }

    // Persist selected family preference
    const updatedSelectedOverrides = {
      ...(settings.selectedFamilyOverrides || {}),
      [module]: newFam,
    }
    onUpdateSettings({ selectedFamilyOverrides: updatedSelectedOverrides })
  }

  const handleSavePrompt = () => {
    const targetFamily: ModelFamily = selectedFamily === 'auto' ? detectedFamily : selectedFamily
    const overrideKey = `${module}:${targetFamily}`
    const updatedPromptOverrides = {
      ...(settings.customPromptOverrides || {}),
      [overrideKey]: promptText,
    }

    onUpdateSettings({ customPromptOverrides: updatedPromptOverrides })
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 2500)
  }

  const handleResetCurrentPrompt = () => {
    const targetFamily: ModelFamily = selectedFamily === 'auto' ? detectedFamily : selectedFamily
    const overrideKey = `${module}:${targetFamily}`
    const updatedPromptOverrides = { ...(settings.customPromptOverrides || {}) }
    delete updatedPromptOverrides[overrideKey]

    const factoryDefault = DEFAULT_FAMILY_PROMPTS[module]?.[targetFamily] || DEFAULT_FAMILY_PROMPTS[module]?.generic || ''
    setPromptText(factoryDefault)
    onUpdateSettings({ customPromptOverrides: updatedPromptOverrides })

    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 2500)
  }

  const handleResetAllModulePrompts = () => {
    const updatedPromptOverrides = { ...(settings.customPromptOverrides || {}) }
    for (const key of Object.keys(updatedPromptOverrides)) {
      if (key.startsWith(`${module}:`)) {
        delete updatedPromptOverrides[key]
      }
    }

    const updatedSelectedOverrides = { ...(settings.selectedFamilyOverrides || {}) }
    delete updatedSelectedOverrides[module]

    setSelectedFamily('auto')
    const factoryDefault = DEFAULT_FAMILY_PROMPTS[module]?.[detectedFamily] || DEFAULT_FAMILY_PROMPTS[module]?.generic || ''
    setPromptText(factoryDefault)

    onUpdateSettings({
      customPromptOverrides: updatedPromptOverrides,
      selectedFamilyOverrides: updatedSelectedOverrides,
    })

    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 2500)
  }

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(promptText)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    } catch (err) {
      console.error('Failed copying prompt to clipboard:', err)
    }
  }

  const activeFamilyMeta = MODEL_FAMILIES.find((f) => f.id === effectiveFamily)
  const isCustomized = !!settings.customPromptOverrides?.[`${module}:${effectiveFamily}`]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="system-prompt-modal-title"
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl flex flex-col shadow-2xl overflow-hidden max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
              <Sliders className="w-5 h-5 text-cyan-400" />
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
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-2 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-xl transition-colors focus-ring active:scale-95"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Active Model & Detected Family Bar */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <span className="text-slate-400">{t('systemPrompt.activeModel')}:</span>
              <span className="font-mono text-slate-200 font-semibold">{activeModelName || t('common.none')}</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-400">{t('systemPrompt.detectedFamily')}:</span>
              <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 font-mono font-bold border border-cyan-800/60 text-[11px]">
                {MODEL_FAMILIES.find((f) => f.id === detectedFamily)?.name || detectedFamily}
              </span>
            </div>
          </div>

          {/* Family Preset Selector Dropdown */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="system-prompt-family-select" className="font-semibold text-slate-300">{t('systemPrompt.familyPreset')}:</label>
              {isCustomized && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950 text-amber-300 font-mono font-bold border border-amber-800/50">
                  {t('systemPrompt.customBadge')}
                </span>
              )}
            </div>

            <select
              id="system-prompt-family-select"
              value={selectedFamily}
              onChange={(e) => handleFamilyChange(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus-ring font-mono"
            >
              <option value="auto">
                ✨ Auto-Detect ({MODEL_FAMILIES.find((f) => f.id === detectedFamily)?.name})
              </option>

              <optgroup label="Text & Coding Models">
                {MODEL_FAMILIES.filter((f) => f.category === 'text_coder').map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </optgroup>

              <optgroup label="Vision & Multimodal Models">
                {MODEL_FAMILIES.filter((f) => f.category === 'vision').map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </optgroup>

              <optgroup label="Vector Embedding Models">
                {MODEL_FAMILIES.filter((f) => f.category === 'embedding').map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </optgroup>

              <optgroup label="Fallback">
                <option value="generic">Generic / Fallback</option>
              </optgroup>
            </select>

            {activeFamilyMeta && (
              <p className="text-[11px] text-slate-400 italic px-1">{activeFamilyMeta.description}</p>
            )}
          </div>

          {/* Prompt Editor Textarea */}
          <div className="space-y-1.5 flex-1 flex flex-col">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="system-prompt-editor-text" className="font-semibold text-slate-300">{t('systemPrompt.promptText')}:</label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCopyPrompt}
                  className="text-[11px] text-slate-400 hover:text-cyan-300 flex items-center gap-1 transition-colors"
                  title={t('common.copy')}
                >
                  {copySuccess ? (
                    <span className="text-emerald-400 font-semibold flex items-center gap-0.5">
                      <Check className="w-3 h-3" /> {t('common.copied')}
                    </span>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" /> {t('common.copy')}
                    </>
                  )}
                </button>
                <span className="text-[10px] text-slate-500 font-mono">{promptText.length} chars</span>
              </div>
            </div>

            <textarea
              id="system-prompt-editor-text"
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              rows={10}
              aria-label={t('systemPrompt.promptText')}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-200 focus-ring resize-y leading-relaxed"
              placeholder="System prompt..."
            />
          </div>

          {/* Variable Placeholders Legend */}
          <div className="p-3 rounded-xl bg-slate-950/40 border border-slate-800/80 text-[11px] text-slate-400 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-slate-300">
              <Info className="w-3.5 h-3.5 text-cyan-400" /> {t('systemPrompt.variablesLegend')}:
            </div>
            <div className="font-mono text-[10px] text-cyan-300/80 space-x-2">
              {module === 'coding' && (
                <span>{`{userTask}`} • {`{workspacePath}`} • {`{agentMode}`} • {`{stepCount}`} • {`{MAX_STEPS}`}</span>
              )}
              {module === 'chat' && <span>{`{userMsgText}`} • {`{contextStr}`}</span>}
              {module === 'translation' && <span>{`{sourceLang}`} • {`{targetLang}`} • {`{chunkText}`}</span>}
              {module === 'vision' && <span>{`{filename}`} • {`{currentPage}`} • {`{numPages}`} • {`{activePageContent}`}</span>}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={handleResetCurrentPrompt}
              className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-rose-400 hover:text-rose-300 text-xs font-medium rounded-xl transition-all flex items-center gap-1.5"
              title={t('systemPrompt.resetFamily')}
            >
              <RotateCcw className="w-3 h-3" /> {t('systemPrompt.resetFamily')}
            </button>

            <button
              onClick={handleResetAllModulePrompts}
              className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-rose-400 text-xs font-medium rounded-xl transition-all"
              title={t('systemPrompt.resetAllModule')}
            >
              {t('systemPrompt.resetAllModule')}
            </button>
          </div>

          <div className="flex items-center gap-2">
            {saveSuccess && (
              <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1" role="status" aria-live="polite">
                <Check className="w-4 h-4" /> {t('common.saved')}
              </span>
            )}

            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-medium rounded-xl transition-all"
            >
              {t('common.close')}
            </button>

            <button
              onClick={handleSavePrompt}
              className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-semibold rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-cyan-950/50 active:scale-95"
            >
              <Save className="w-3.5 h-3.5 fill-current" /> {t('systemPrompt.savePrompt')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
