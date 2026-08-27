import React, { useState, useEffect } from 'react'
import { DiagnosticsData, AppSettings, RunningModelInfo } from '../../types'
import {
  Settings,
  Download,
  Trash2,
  Zap,
  Loader2,
  Globe,
  Heart,
  Award,
  FolderOpen,
  WrapText,
  Volume2,
  Cpu,
  Layers,
  Sparkles,
  Sliders,
  PowerOff,
  ArrowUpCircle,
  RefreshCw,
} from 'lucide-react'
import { InlineDestructiveConfirm } from '../common/InlineDestructiveConfirm'
import { HardwareSetupWizardModal } from '../common/HardwareSetupWizardModal'
import { PromptConfigurationModal } from './PromptConfigurationModal'
import { ToggleSwitch } from '../common/ToggleSwitch'
import { ModelAssignmentGrid } from './ModelAssignmentGrid'
import { OcrEngineSelector } from './OcrEngineSelector'
import { AgentExecutionLimitsConfig } from './AgentExecutionLimitsConfig'
import { OllamaServerConfig } from './OllamaServerConfig'
import { useSettingsManager } from '../../hooks/useSettingsManager'
import { useOllamaModelMetrics } from '../../hooks/useOllamaModelMetrics'
import { useOllamaModelUpdates } from '../../hooks/useOllamaModelUpdates'
import { useTranslation, Language } from '../../i18n'
import { apiService } from '../../services/api'
import { compareContextAllocation } from '../../services/contextAllocation'
import { ModelContextControl } from './ModelContextControl'
import { extractHardwareFacts } from '../../services/hardwareRecommendationEngine'
import { resolveMaxContextTokens } from '../../services/hardwareProfileTiers'

interface SettingsViewProps {
  diagnostics: DiagnosticsData | null
  settings: AppSettings
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void
  onRefreshDiagnostics: () => void
  onOpenAboutModal?: () => void
  onOpenWizard?: () => void
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  diagnostics,
  settings,
  onUpdateSettings,
  onRefreshDiagnostics,
  onOpenAboutModal,
  onOpenWizard,
}) => {
  const { t, language, setLanguage } = useTranslation()
  const s = useSettingsManager(diagnostics, settings, onUpdateSettings, onRefreshDiagnostics)
  const { metrics: modelMetrics } = useOllamaModelMetrics(settings.ollamaHost)
  const hardwareDefault = resolveMaxContextTokens('Auto', extractHardwareFacts(diagnostics))
  const {
    updateAvailableMap,
    isCheckingUpdates,
    checkForUpdates,
    triggerUpdateModel,
    isModelUpdating,
    isAnyModelUpdating,
    downloadProgress,
  } = useOllamaModelUpdates(settings.ollamaHost, onRefreshDiagnostics)
  const [runningModels, setRunningModels] = useState<RunningModelInfo[]>([])

  useEffect(() => {
    let cancelled = false
    const fetchRunning = async () => {
      if (!window.electronAPI?.getRunningModels) return
      try {
        const res = await window.electronAPI.getRunningModels(settings.ollamaHost)
        if (!cancelled && res?.success && Array.isArray(res.models)) {
          setRunningModels(res.models)
        }
      } catch {
        if (!cancelled) setRunningModels([])
      }
    }
    void fetchRunning()
    return () => {
      cancelled = true
    }
  }, [settings.ollamaHost, diagnostics?.timestamp, s.pullMessage])

  const handleLanguageChange = (newLang: Language) => {
    setLanguage(newLang)
    onUpdateSettings({ language: newLang })
  }

  const handleOpenWizard = () => {
    if (onOpenWizard) {
      onOpenWizard()
    } else {
      s.setIsWizardOpen(true)
    }
  }

  return (
    <div className="flex-1 h-full overflow-y-auto p-8 space-y-9 bg-slate-950 select-text">
      {/* Page Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-5">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shadow-sm shrink-0">
            <Settings className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-100">
              {t('settings.title')}
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">
              {t('settings.description')}
            </p>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SEZIONE 1: PREFERENZE GENERALI & INTERFACCIA                              */}
      {/* ========================================================================= */}
      <section className="space-y-4">
        <div className="flex items-center gap-2.5 px-1">
          <Sliders className="w-4.5 h-4.5 text-cyan-400" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">
            1. {t('settings.generalPreferencesSection')}
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card: Lingua Interfaccia */}
          <div className="glass-panel rounded-xl p-5 border border-slate-800 flex flex-col justify-between space-y-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-slate-100 font-bold text-sm">
                <Globe className="w-4.5 h-4.5 text-cyan-400" />
                <span>{t('settings.languagePreference')}</span>
              </div>
              <p className="text-xs text-slate-400">{t('settings.languageDescription')}</p>
            </div>
            <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800/80">
              <button
                type="button"
                onClick={() => handleLanguageChange('it')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all focus-ring ${
                  language === 'it'
                    ? 'bg-cyan-600 text-slate-950 shadow-md shadow-cyan-950/50'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                🇮🇹 Italiano
              </button>
              <button
                type="button"
                onClick={() => handleLanguageChange('en')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all focus-ring ${
                  language === 'en'
                    ? 'bg-cyan-600 text-slate-950 shadow-md shadow-cyan-950/50'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                🇬🇧 English
              </button>
            </div>
          </div>

          {/* Card: Word Wrap Editor */}
          <div className="glass-panel rounded-xl p-5 border border-slate-800 flex flex-col justify-between space-y-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-100 font-bold text-sm">
                  <WrapText className="w-4.5 h-4.5 text-cyan-400" />
                  <span>{t('settings.wordWrap')}</span>
                </div>
                <ToggleSwitch
                  checked={settings.editorWordWrap !== false}
                  onChange={(checked) => onUpdateSettings({ editorWordWrap: checked })}
                  ariaLabel={t('settings.wordWrap')}
                />
              </div>
              <p className="text-xs text-slate-400">{t('settings.wordWrapDesc')}</p>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
              <span className="w-2 h-2 rounded-full bg-cyan-400/80" />
              <span>{settings.editorWordWrap !== false ? t('common.active') : t('common.offline')}</span>
            </div>
          </div>

          {/* Card: Effetti Sonori UI */}
          <div className="glass-panel rounded-xl p-5 border border-slate-800 flex flex-col justify-between space-y-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-100 font-bold text-sm">
                  <Volume2 className="w-4.5 h-4.5 text-cyan-400" />
                  <span>{t('settings.soundEffects')}</span>
                </div>
                <ToggleSwitch
                  checked={settings.enableSoundEffects !== false}
                  onChange={(checked) => onUpdateSettings({ enableSoundEffects: checked })}
                  ariaLabel={t('settings.soundEffects')}
                />
              </div>
              <p className="text-xs text-slate-400">{t('settings.soundEffectsDesc')}</p>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
              <span className="w-2 h-2 rounded-full bg-cyan-400/80" />
              <span>{settings.enableSoundEffects !== false ? t('common.active') : t('common.offline')}</span>
            </div>
          </div>
        </div>

        {/* Card: Percorsi e Cartelle di Sistema */}
        <div className="glass-panel rounded-xl p-5 border border-slate-800 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-800/80 pb-3">
            <FolderOpen className="w-5 h-5 text-cyan-400" />
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                {t('settings.systemDirectoriesTitle')}
              </h3>
              <p className="text-xs text-slate-400">
                {t('settings.systemDirectoriesDesc')}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            {/* Cartella Output Traduzioni */}
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <FolderOpen className="w-4 h-4 text-cyan-400" /> {t('settings.translationOutputFolderTitle')}
                </span>
                {settings.translationOutputFolder && (
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ translationOutputFolder: undefined })}
                    className="p-1 text-slate-400 hover:text-rose-400 rounded-lg transition-colors focus-ring"
                    title={t('settings.translationOutputFolderClear')}
                    aria-label={t('settings.translationOutputFolderClear')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-400 leading-tight">
                {t('settings.translationOutputFolderDesc')}
              </p>
              <div className="text-[11px] font-mono text-slate-300 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 break-all">
                {settings.translationOutputFolder || t('settings.translationOutputFolderNotSet')}
              </div>
              <button
                type="button"
                onClick={async () => {
                  const chosen = await apiService.openDirectoryDialog({
                    title: t('settings.translationOutputFolderTitle'),
                  })
                  if (chosen) onUpdateSettings({ translationOutputFolder: chosen })
                }}
                className="w-full py-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-700 hover:border-cyan-500/50 text-slate-200 text-xs font-semibold rounded-lg transition-all focus-ring flex items-center justify-center gap-2 active:scale-95 shadow-sm"
              >
                <FolderOpen className="w-3.5 h-3.5 text-cyan-400" /> {t('settings.translationOutputFolderBrowse')}
              </button>
            </div>

            {/* Cartella Log Applicativi */}
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <FolderOpen className="w-4 h-4 text-cyan-400" /> {t('settings.appLogsFolderTitle')}
                </span>
                <span className="text-[10px] font-mono text-slate-400">logs/</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-tight">
                {t('settings.appLogsFolderDesc')}
              </p>
              <div className="text-[11px] font-mono text-slate-300 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 break-all">
                AppData/Roaming/onlyrag-v2/logs
              </div>
              <button
                type="button"
                onClick={async () => {
                  await apiService.openLogsFolder()
                }}
                className="w-full py-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-700 hover:border-cyan-500/50 text-slate-200 text-xs font-semibold rounded-lg transition-all focus-ring flex items-center justify-center gap-2 active:scale-95 shadow-sm"
              >
                <FolderOpen className="w-3.5 h-3.5 text-cyan-400" /> {t('settings.openLogsFolder')}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* SEZIONE 2: HARDWARE, GPU & RUNTIME AI                                     */}
      {/* ========================================================================= */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-4.5 h-4.5 text-amber-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">
              2. {t('settings.hardwareRuntimeSection')}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleOpenWizard}
            aria-label={t('settings.hardwareWizard')}
            className="px-3 py-1.5 bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 text-slate-950 font-bold text-xs rounded-xl transition-all focus-ring flex items-center gap-1.5 shadow-md shadow-cyan-950/40 active:scale-95 cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5 fill-current" /> {t('settings.hardwareWizard')}
          </button>
        </div>

        {/* Ollama Server Configuration (Local vs Remote Network Server) */}
        <OllamaServerConfig
          settings={settings}
          onUpdateSettings={onUpdateSettings}
          onRefreshDiagnostics={onRefreshDiagnostics}
        />

        {/* OCR Engine Selector */}
        <OcrEngineSelector
          settings={settings}
          onUpdateSettings={onUpdateSettings}
        />
      </section>

      {/* ========================================================================= */}
      {/* SEZIONE 3: MODELLI AI & GESTIONE PESI LOCALI                             */}
      {/* ========================================================================= */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4.5 h-4.5 text-cyan-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">
              3. {t('settings.modelsWeightsSection')}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => s.setActivePromptNodeId('coding:master')}
            aria-label={t('promptConfig.title')}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-medium rounded-xl transition-colors focus-ring flex items-center gap-1.5 active:scale-95 shadow-sm cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5 text-cyan-400" /> {t('promptConfig.title')}
          </button>
        </div>

        {/* Per-Section Model Assignment Grid */}
        <ModelAssignmentGrid
          settings={settings}
          diagnostics={diagnostics}
          onUpdateSettings={onUpdateSettings}
        />

        {/* Ollama Model Management Panel */}
        <div className="glass-panel rounded-xl p-5 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2.5">
              <Download className="w-5 h-5 text-cyan-400" />
              <div>
                <h3 className="text-sm font-bold text-slate-100">{t('settings.ollamaManagement')}</h3>
                <p className="text-xs text-slate-400">{t('settings.ollamaManagementDesc')}</p>
              </div>
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              s.handlePullModel()
            }}
            className="flex items-center gap-3"
          >
            <input
              type="text"
              value={s.pullModelInput}
              onChange={(e) => s.setPullModelInput(e.target.value)}
              placeholder={t('settings.pullModelPlaceholder')}
              aria-label={t('settings.pullModelAria')}
              className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-200 outline-none flex-1 focus-ring"
            />
            <button
              type="submit"
              disabled={s.isPulling || !s.pullModelInput.trim()}
              aria-label={s.isPulling ? t('settings.downloading') : t('settings.downloadModel')}
              className="px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold text-xs rounded-xl transition-colors focus-ring flex items-center gap-2 active:scale-95 shadow-sm"
            >
              {s.isPulling ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                  <span>{t('settings.downloading')}</span>
                </>
              ) : (
                <span>{t('settings.downloadModel')}</span>
              )}
            </button>
          </form>

          {s.pullMessage && <p className="text-xs text-cyan-300 font-mono">{s.pullMessage}</p>}

          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                {t('settings.installedLocalModels')} ({diagnostics?.ollama.models?.length || 0})
              </h4>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={isCheckingUpdates}
                  onClick={() => checkForUpdates()}
                  className="text-[11px] text-amber-400 hover:text-amber-300 disabled:opacity-50 flex items-center gap-1 font-semibold hover:underline cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${isCheckingUpdates ? 'animate-spin' : ''}`} />
                  {isCheckingUpdates ? t('settings.checkingUpdates') : t('settings.checkUpdates')}
                </button>
                <button
                  type="button"
                  onClick={onRefreshDiagnostics}
                  className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-semibold hover:underline cursor-pointer"
                >
                  <Zap className="w-3 h-3" /> Aggiorna Stato Modelli
                </button>
              </div>
            </div>

            {diagnostics?.ollama.models && diagnostics.ollama.models.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {diagnostics.ollama.models.map((modelName) => {
                  const m = modelMetrics[modelName]
                  const runningInfo = runningModels.find((r) => r.name === modelName || r.model === modelName)
                  const isRunning = Boolean(runningInfo)
                  const hasUpdate = Boolean(updateAvailableMap[modelName])
                  const isUpdatingThis = isModelUpdating(modelName)
                  const vramBytes = runningInfo?.size_vram || 0
                  const vramGB = (vramBytes / 1024 ** 3).toFixed(1)
                  const requestedContext = settings.modelContextLengths?.[modelName]
                  const contextStatus = compareContextAllocation(requestedContext, runningInfo?.context_length)

                  return (
                    <div
                      key={modelName}
                      className={`p-4 rounded-xl border flex flex-col justify-between space-y-3 transition-all ${
                        isUpdatingThis
                          ? 'bg-amber-950/20 border-amber-500/50 shadow-md shadow-amber-950/30 ring-1 ring-amber-500/40'
                          : isRunning
                          ? 'bg-cyan-950/30 border-cyan-500/50 shadow-md shadow-cyan-950/30 ring-1 ring-cyan-500/30'
                          : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {/* Top Model Title & Status */}
                      <div className="space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-bold text-slate-100 text-xs truncate flex-1" title={modelName}>
                            {modelName}
                          </div>
                          {isUpdatingThis ? (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-amber-950/80 text-amber-300 border border-amber-700/60 shrink-0 flex items-center gap-1">
                              <Loader2 className="w-2.5 h-2.5 animate-spin text-amber-400" /> {t('settings.updating')}
                            </span>
                          ) : isRunning ? (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 shrink-0 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> In Memoria
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-mono text-slate-400 bg-slate-950 border border-slate-800 shrink-0">
                              Su Disco
                            </span>
                          )}
                      </div>

                      <ModelContextControl
                        model={modelName}
                        settings={settings}
                        metrics={modelMetrics[modelName]}
                        hardwareDefault={hardwareDefault}
                        onUpdateSettings={onUpdateSettings}
                      />

                      {/* Running VRAM / RAM detail if active */}
                        {isRunning && (
                          <div className="space-y-1 text-[10px] font-mono text-emerald-400/90 bg-emerald-950/30 px-2 py-1 rounded-lg border border-emerald-900/40">
                            <div>VRAM: {vramGB} GB</div>
                            {runningInfo?.context_length !== undefined && (
                              <div className={contextStatus === 'underallocated' ? 'text-amber-300' : undefined}>
                                Context allocato: {runningInfo.context_length} token
                                {requestedContext !== undefined ? ` / richiesto: ${requestedContext}` : ''}
                                {contextStatus === 'underallocated' ? ' (inferiore)' : ''}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Update Available Badge & Action */}
                      {hasUpdate && !isUpdatingThis && (
                        <div className="flex items-center justify-between p-2 rounded-lg bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs">
                          <div className="flex items-center gap-1.5 font-semibold text-[11px]">
                            <ArrowUpCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            <span>{t('settings.updateAvailable')}</span>
                          </div>
                          <button
                            type="button"
                            disabled={isAnyModelUpdating}
                            onClick={() => triggerUpdateModel(modelName)}
                            title={isAnyModelUpdating ? t('settings.anotherModelUpdating') : t('settings.updateNow')}
                            className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold text-[10px] rounded-lg transition-all active:scale-95 cursor-pointer shadow-sm flex items-center gap-1"
                          >
                            <Download className="w-3 h-3" />
                            <span>{t('settings.updateNow')}</span>
                          </button>
                        </div>
                      )}

                      {/* Streaming Progress Bar during Update */}
                      {isUpdatingThis && (
                        <div className="p-2.5 rounded-lg bg-slate-950/80 border border-amber-500/40 space-y-1.5 font-mono text-[11px]">
                          <div className="flex items-center justify-between text-amber-300">
                            <span className="flex items-center gap-1 font-bold">
                              <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                              {downloadProgress.status || t('settings.updating')}
                            </span>
                            <span className="font-bold">{downloadProgress.percent}%</span>
                          </div>
                          <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden border border-slate-800">
                            <div
                              className="bg-gradient-to-r from-amber-500 to-emerald-400 h-full transition-all duration-200"
                              style={{ width: `${downloadProgress.percent}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-[10px] text-slate-400">
                            <span className="truncate max-w-[130px]">{downloadProgress.status}</span>
                            <span>{downloadProgress.mbCompleted} / {downloadProgress.mbTotal} MB</span>
                          </div>
                        </div>
                      )}

                      {/* Specs & Metrics Grid */}
                      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80">
                        <div>
                          <span className="text-slate-400 block text-[9px] uppercase tracking-wider">Parametri:</span>
                          <span className="font-bold text-cyan-300">{m?.parameterSize || 'N/D'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[9px] uppercase tracking-wider">Quantizzazione:</span>
                          <span className="font-bold text-slate-200">{m?.quantizationLevel || 'N/D'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[9px] uppercase tracking-wider">Peso su Disco:</span>
                          <span className="font-bold text-slate-200">
                            {m?.sizeBytes ? `${(m.sizeBytes / 1024 ** 3).toFixed(2)} GB` : 'N/D'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[9px] uppercase tracking-wider">Famiglia:</span>
                          <span className="font-bold text-slate-200 capitalize">{m?.family || 'N/D'}</span>
                        </div>
                      </div>

                      {/* Capabilities badges */}
                      {m?.capabilities && m.capabilities.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {m.capabilities.map((cap) => (
                            <span
                              key={cap}
                              className="px-1.5 py-0.5 rounded text-[9px] font-mono font-medium bg-slate-950 text-slate-300 border border-slate-800"
                            >
                              {cap === 'tools' ? '🛠️ Tools' : cap === 'vision' ? '👁️ Vision' : cap === 'embedding' ? '📐 Embed' : `💬 ${cap}`}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                        {isRunning ? (
                          <button
                            type="button"
                            onClick={() => s.handleUnloadModel(modelName)}
                            title="Scarica il modello dalla memoria VRAM/RAM"
                            className="px-2.5 py-1 bg-amber-950/40 hover:bg-amber-900/60 border border-amber-800/50 text-amber-300 text-[10px] font-semibold rounded-lg transition-all focus-ring flex items-center gap-1 cursor-pointer"
                          >
                            <PowerOff className="w-3 h-3" /> Scarica RAM
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-mono">Modello pronto</span>
                        )}

                        <InlineDestructiveConfirm
                          itemLabel={modelName}
                          iconClassName="w-4 h-4"
                          actionLabel={t('settings.deleteModel')}
                          onConfirm={() => s.handleDeleteModel(modelName)}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-400">{t('settings.noModelsDetected')}</p>
            )}
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* SEZIONE 4: AGENTE, LIMITI DI ESECUZIONE & DEBUG                           */}
      {/* ========================================================================= */}
      <section className="space-y-4">
        <div className="flex items-center gap-2.5 px-1">
          <Layers className="w-4.5 h-4.5 text-emerald-400" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">
            4. {t('settings.agentLimitsSection')}
          </h2>
        </div>

        {/* Agent Execution Limits */}
        <AgentExecutionLimitsConfig
          settings={settings}
          onUpdateSettings={onUpdateSettings}
        />

        {/* Coding Agent Studio Audit & Debug Logging */}
        <div className="glass-panel rounded-xl p-5 border border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <FolderOpen className="w-4.5 h-4.5 text-emerald-400" /> {t('settings.codingAgentDebugLog')}
              </h3>
              <p className="text-xs text-slate-400 max-w-2xl">
                {t('settings.codingAgentDebugLogDesc')}
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <ToggleSwitch
                checked={Boolean(settings.enableCodingAgentDebugLog)}
                onChange={(checked) => onUpdateSettings({ enableCodingAgentDebugLog: checked })}
                activeColor="bg-emerald-500"
                ariaLabel={t('settings.codingAgentDebugLog')}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* SEZIONE 5: INFORMAZIONI & RICONOSCIMENTI (ABOUT)                           */}
      {/* ========================================================================= */}
      <div className="glass-panel rounded-xl p-5 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <Heart className="w-4.5 h-4.5 text-rose-400 fill-rose-400/20" /> {t('settings.aboutSectionTitle')}
          </h3>
          <p className="text-xs text-slate-400 max-w-xl">
            {t('settings.aboutSectionDescription')}
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenAboutModal}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-cyan-500/50 text-slate-200 text-xs font-semibold rounded-xl transition-all focus-ring flex items-center gap-2 shrink-0 active:scale-95 shadow-sm"
        >
          <Award className="w-4 h-4 text-cyan-400" /> {t('settings.viewAboutButton')}
        </button>
      </div>

      {!onOpenWizard && (
        <HardwareSetupWizardModal
          isOpen={s.isWizardOpen}
          onClose={() => s.setIsWizardOpen(false)}
          diagnostics={diagnostics}
          settings={settings}
          onUpdateSettings={onUpdateSettings}
          onRefreshDiagnostics={onRefreshDiagnostics}
        />
      )}

      {s.activePromptNodeId && (
        <PromptConfigurationModal
          isOpen
          onClose={() => s.setActivePromptNodeId(null)}
          initialNodeId={s.activePromptNodeId}
          settings={settings}
          onUpdateSettings={onUpdateSettings}
        />
      )}
    </div>
  )
}
