import React, { useState, useEffect, useRef } from 'react'
import { AppSettings } from '../../types'
import {
  FeatureModule,
  ModelFamily,
  MODEL_FAMILIES,
  DEFAULT_FAMILY_PROMPTS,
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
  Download,
  Upload,
  Eye,
  Edit3,
  AlertCircle,
  Plus,
} from 'lucide-react'
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

export const SAMPLE_PREVIEW_VARS: Record<FeatureModule, Record<string, string>> = {
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

export const compilePromptWithSampleVars = (
  rawTemplate: string,
  module: FeatureModule
): string => {
  const vars = SAMPLE_PREVIEW_VARS[module] || {}
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
  const detectedFamily = detectModelFamily(activeModelName)
  const currentOverrideFamily = settings.selectedFamilyOverrides?.[module] || 'auto'

  const [selectedFamily, setSelectedFamily] = useState<ModelFamily | 'auto'>(currentOverrideFamily as any)
  const effectiveFamily: ModelFamily = selectedFamily === 'auto' ? detectedFamily : selectedFamily

  const [promptText, setPromptText] = useState<string>('')
  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor')
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)
  const [importStatus, setImportStatus] = useState<{ success?: boolean; message?: string } | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
      setActiveTab('editor')
      setImportStatus(null)
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
      const textToCopy = activeTab === 'preview'
        ? compilePromptWithSampleVars(promptText, module)
        : promptText
      await navigator.clipboard.writeText(textToCopy)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    } catch (err) {
      console.error('Failed copying prompt to clipboard:', err)
    }
  }

  const handleInsertVariable = (varName: string) => {
    if (textareaRef.current) {
      const ta = textareaRef.current
      const start = ta.selectionStart || 0
      const end = ta.selectionEnd || 0
      const nextText = promptText.substring(0, start) + varName + promptText.substring(end)
      setPromptText(nextText)
      setTimeout(() => {
        ta.focus()
        ta.setSelectionRange(start + varName.length, start + varName.length)
      }, 0)
    } else {
      setPromptText((prev) => prev + (prev.endsWith(' ') || prev.endsWith('\n') ? '' : ' ') + varName)
    }
  }

  const handleExportJson = () => {
    const exportData = {
      app: 'OnlyRagV2',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      customPromptOverrides: settings.customPromptOverrides || {},
      selectedFamilyOverrides: settings.selectedFamilyOverrides || {},
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `onlyrag_system_prompts_${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string)
        if (parsed && (parsed.customPromptOverrides || parsed.selectedFamilyOverrides)) {
          const mergedPromptOverrides = {
            ...(settings.customPromptOverrides || {}),
            ...(parsed.customPromptOverrides || {}),
          }
          const mergedFamilyOverrides = {
            ...(settings.selectedFamilyOverrides || {}),
            ...(parsed.selectedFamilyOverrides || {}),
          }

          onUpdateSettings({
            customPromptOverrides: mergedPromptOverrides,
            selectedFamilyOverrides: mergedFamilyOverrides,
          })

          const targetFamily: ModelFamily = selectedFamily === 'auto' ? detectedFamily : selectedFamily
          const overrideKey = `${module}:${targetFamily}`
          if (mergedPromptOverrides[overrideKey] !== undefined) {
            setPromptText(mergedPromptOverrides[overrideKey])
          }

          setImportStatus({ success: true, message: t('systemPrompt.importSuccess') })
          setTimeout(() => setImportStatus(null), 3000)
        } else {
          setImportStatus({ success: false, message: t('systemPrompt.importError') })
          setTimeout(() => setImportStatus(null), 3000)
        }
      } catch {
        setImportStatus({ success: false, message: t('systemPrompt.importError') })
        setTimeout(() => setImportStatus(null), 3000)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const activeFamilyMeta = MODEL_FAMILIES.find((f) => f.id === effectiveFamily)
  const isCustomized = !!settings.customPromptOverrides?.[`${module}:${effectiveFamily}`]
  const moduleVars = MODULE_VARIABLES[module] || []
  const compiledPreviewText = compilePromptWithSampleVars(promptText, module)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="system-prompt-modal-title"
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl flex flex-col shadow-2xl overflow-hidden max-h-[90vh]">
        {/* Hidden file input for import */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleImportJson}
          accept=".json,application/json"
          className="hidden"
        />

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

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportJson}
              title={t('systemPrompt.exportJson')}
              className="p-2 hover:bg-slate-800 text-slate-400 hover:text-cyan-300 rounded-xl transition-colors text-xs flex items-center gap-1.5 focus-ring"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">{t('systemPrompt.exportJson')}</span>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              title={t('systemPrompt.importJson')}
              className="p-2 hover:bg-slate-800 text-slate-400 hover:text-cyan-300 rounded-xl transition-colors text-xs flex items-center gap-1.5 focus-ring"
            >
              <Upload className="w-4 h-4" />
              <span className="hidden sm:inline">{t('systemPrompt.importJson')}</span>
            </button>

            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="p-2 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-xl transition-colors focus-ring active:scale-95"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Import notification feedback */}
          {importStatus && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                importStatus.success
                  ? 'bg-emerald-950/70 border-emerald-800 text-emerald-300'
                  : 'bg-rose-950/70 border-rose-800 text-rose-300'
              }`}
            >
              {importStatus.success ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              <span>{importStatus.message}</span>
            </div>
          )}

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
              <label htmlFor="system-prompt-family-select" className="font-semibold text-slate-300">
                {t('systemPrompt.familyPreset')}:
              </label>
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

          {/* Mode Switcher Tabs (Editor vs Compiled Preview) */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('editor')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  activeTab === 'editor'
                    ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Edit3 className="w-3.5 h-3.5" />
                {t('systemPrompt.editTab')}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('preview')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  activeTab === 'preview'
                    ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                {t('systemPrompt.previewTab')}
              </button>
            </div>

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
              <span className="text-[10px] text-slate-500 font-mono">
                {activeTab === 'preview' ? `${compiledPreviewText.length} chars (compiled)` : `${promptText.length} chars`}
              </span>
            </div>
          </div>

          {/* Main Body (Editor or Compiled Preview) */}
          {activeTab === 'editor' ? (
            <div className="space-y-1.5 flex-1 flex flex-col">
              <textarea
                ref={textareaRef}
                id="system-prompt-editor-text"
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                rows={10}
                aria-label={t('systemPrompt.promptText')}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-200 focus-ring resize-y leading-relaxed"
                placeholder={t('systemPrompt.systemPromptPlaceholder')}
              />
            </div>
          ) : (
            <div className="space-y-2 flex-1 flex flex-col">
              <div className="p-2.5 rounded-lg bg-cyan-950/40 border border-cyan-900/50 text-[11px] text-cyan-300 flex items-center gap-2">
                <Info className="w-4 h-4 shrink-0 text-cyan-400" />
                <span>{t('systemPrompt.previewDescription')}</span>
              </div>
              <div className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-300 leading-relaxed max-h-[300px] overflow-y-auto whitespace-pre-wrap select-text">
                {compiledPreviewText}
              </div>
            </div>
          )}

          {/* Interactive Variable Validation & Insertion Badges */}
          <div className="p-3.5 rounded-xl bg-slate-950/40 border border-slate-800/80 text-[11px] space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-semibold text-slate-300">
                <Info className="w-3.5 h-3.5 text-cyan-400" />
                <span>{t('systemPrompt.variablesLegend')}</span>
              </div>
              <span className="text-[10px] text-slate-500">{t('systemPrompt.clickToInsert')}</span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {moduleVars.map((v) => {
                const isPresent = promptText.includes(v.name)
                return (
                  <button
                    key={v.name}
                    type="button"
                    onClick={() => handleInsertVariable(v.name)}
                    title={`${v.description} (${isPresent ? 'Presente' : v.required ? 'Mancante consigliato' : 'Opzionale'})`}
                    className={`px-2 py-1 rounded-md font-mono text-[10px] flex items-center gap-1 transition-all border ${
                      isPresent
                        ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800/60 hover:bg-emerald-900/50'
                        : v.required
                        ? 'bg-amber-950/60 text-amber-300 border-amber-800/60 hover:bg-amber-900/60'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {isPresent ? (
                      <Check className="w-2.5 h-2.5 text-emerald-400" />
                    ) : (
                      <Plus className="w-2.5 h-2.5 text-amber-400" />
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
