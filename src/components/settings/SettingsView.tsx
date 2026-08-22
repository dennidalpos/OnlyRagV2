import React, { useState } from 'react'
import { DiagnosticsData, AppSettings } from '../../types'
import {
  Settings,
  RefreshCw,
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
} from 'lucide-react'
import { HardwareSetupWizardModal } from '../common/HardwareSetupWizardModal'
import { ToggleSwitch } from '../common/ToggleSwitch'
import { ModelAssignmentGrid } from './ModelAssignmentGrid'
import { HardwareProfileSelector } from './HardwareProfileSelector'
import { OcrEngineSelector } from './OcrEngineSelector'
import { AgentExecutionLimitsConfig } from './AgentExecutionLimitsConfig'
import { OllamaEnvParamsCard } from './OllamaEnvParamsCard'
import { useSettingsManager } from '../../hooks/useSettingsManager'
import { useTranslation, Language } from '../../i18n'
import { apiService } from '../../services/api'

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
  const [deletingModel, setDeletingModel] = useState<string | null>(null)

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
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-3">
            <Settings className="w-7 h-7 text-cyan-400" /> {t('settings.title')}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            {t('settings.description')}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleOpenWizard}
            aria-label={t('settings.hardwareWizard')}
            className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 text-slate-950 font-bold text-xs rounded-xl transition-all focus-ring flex items-center gap-2 shadow-lg shadow-cyan-950/50 active:scale-95"
          >
            <Zap className="w-4 h-4 fill-current" /> {t('settings.hardwareWizard')}
          </button>

          <button
            type="button"
            onClick={onRefreshDiagnostics}
            aria-label={t('settings.hardwareScan')}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-medium rounded-xl transition-colors focus-ring flex items-center gap-2 active:scale-95 shadow-sm"
          >
            <RefreshCw className="w-4 h-4 text-cyan-400" /> {t('settings.hardwareScan')}
          </button>
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
        <div className="flex items-center gap-2.5 px-1">
          <Cpu className="w-4.5 h-4.5 text-amber-400" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">
            2. {t('settings.hardwareRuntimeSection')}
          </h2>
        </div>

        {/* Hardware Profile Selector */}
        <HardwareProfileSelector
          settings={settings}
          onUpdateSettings={onUpdateSettings}
        />

        {/* Ollama Client OS Parameters */}
        <OllamaEnvParamsCard
          diagnostics={diagnostics}
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
        <div className="flex items-center gap-2.5 px-1">
          <Sparkles className="w-4.5 h-4.5 text-cyan-400" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">
            3. {t('settings.modelsWeightsSection')}
          </h2>
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

          <div className="space-y-2 pt-2">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t('settings.installedLocalModels')}</h4>
            {diagnostics?.ollama.models && diagnostics.ollama.models.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {diagnostics.ollama.models.map((modelName) => (
                  <div key={modelName} className="p-3 bg-slate-900 rounded-xl border border-slate-800 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-slate-200">{modelName}</div>
                    </div>
                    {deletingModel === modelName ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => { s.handleDeleteModel(modelName); setDeletingModel(null) }}
                          className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold text-[10px] rounded-lg transition-colors focus-ring"
                        >
                          {t('settings.confirmDelete')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingModel(null)}
                          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] rounded-lg transition-colors focus-ring"
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeletingModel(modelName)}
                        className="p-1.5 text-slate-400 hover:text-red-400 transition-colors focus-ring rounded-lg"
                        title={t('settings.deleteModel')}
                        aria-label={`${t('settings.deleteModel')} ${modelName}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
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
    </div>
  )
}
