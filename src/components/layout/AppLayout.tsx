import React, { useState, useCallback, useEffect, Suspense, lazy } from 'react'
import { AppSettings } from '../../types'
import {
  Layers,
  FileText,
  MessageSquare,
  Languages,
  Code,
  Settings,
  Zap,
  Cpu,
  HardDrive,
  Terminal,
  Info,
  Globe,
  Download,
  Check,
  X,
} from 'lucide-react'
// The five main views are code-split: only the tabs the user actually opens are
// downloaded, instead of shipping every view inside the initial renderer chunk.
const SettingsView = lazy(() => import('../settings/SettingsView').then((m) => ({ default: m.SettingsView })))
const IngestionView = lazy(() => import('../ingestion/IngestionView').then((m) => ({ default: m.IngestionView })))
const ChatView = lazy(() => import('../chat/ChatView').then((m) => ({ default: m.ChatView })))
const TranslationView = lazy(() => import('../translation/TranslationView').then((m) => ({ default: m.TranslationView })))
const CodingAgentView = lazy(() => import('../coding/CodingAgentView').then((m) => ({ default: m.CodingAgentView })))
import { DiagnosticsDrawer } from '../diagnostics/DiagnosticsDrawer'
import { AboutModal } from '../common/AboutModal'
import { OnlyRagLogo } from '../common/OnlyRagLogo'
import { HardwareSetupWizardModal } from '../common/HardwareSetupWizardModal'
import { useDiagnostics } from '../../hooks/useDiagnostics'
import { useModelDownloadProgress } from '../../hooks/useModelDownloadProgress'
import { notifyTabChanged } from '../../hooks/useIngestedDocuments'
import { useTranslation, Language } from '../../i18n'
import { logger } from '../../lib/logger'

export type NavTab = 'ingestion' | 'chat' | 'translation' | 'coding' | 'settings'

/** Shown only while a view chunk is being fetched for the first time. */
const ViewChunkFallback: React.FC = () => (
  <div
    role="status"
    aria-live="polite"
    className="h-full w-full flex flex-col items-center justify-center text-slate-400 text-xs font-sans gap-3 animate-in fade-in duration-150"
  >
    <div className="w-6 h-6 rounded-full border-2 border-cyan-500/80 border-t-transparent animate-spin shadow-sm shadow-cyan-950" />
    <span className="font-medium text-slate-300">Caricamento interfaccia...</span>
  </div>
)

export const AppLayout: React.FC = () => {
  const { t, language, setLanguage } = useTranslation()
  const [activeTab, setActiveTab] = useState<NavTab>(() => {
    try {
      const savedTab = localStorage.getItem('onlyrag_active_tab') as NavTab
      if (savedTab && ['ingestion', 'chat', 'translation', 'coding', 'settings'].includes(savedTab)) {
        return savedTab
      }
    } catch (err: any) {
      logger.warn('AppLayout', `Failed reading active tab from localStorage: ${err?.message}`)
    }
    return 'ingestion'
  })
  // A view is mounted from the first time its tab is opened and stays mounted afterwards,
  // so switching tabs never discards the state of a view already in use.
  const [visitedTabs, setVisitedTabs] = useState<Set<NavTab>>(() => new Set<NavTab>([activeTab]))
  useEffect(() => {
    setVisitedTabs((prev) => (prev.has(activeTab) ? prev : new Set(prev).add(activeTab)))
  }, [activeTab])

  const [isDiagnosticsDrawerOpen, setIsDiagnosticsDrawerOpen] = useState(false)
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false)
  const [isWizardOpen, setIsWizardOpen] = useState<boolean>(false)

  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('onlyrag_app_settings')
      if (saved) {
        return JSON.parse(saved)
      }
    } catch (err: any) {
      logger.error('AppLayout', `Failed loading app settings from localStorage: ${err.message}`)
    }
    return {
      defaultModel: '',
      hardwareProfile: 'Auto',
      ocrEngine: 'native_cuda',
      ollamaHost: 'http://127.0.0.1:11434',
      language: 'it',
      autoInstallHubSkills: 'auto',
      autoInstallMinScore: 8.0,
    }
  })

  // Auto-launch initial setup wizard on first start
  React.useEffect(() => {
    if (!settings.hasCompletedInitialSetup && !settings.defaultModel) {
      setIsWizardOpen(true)
    }
  }, [settings.hasCompletedInitialSetup, settings.defaultModel])

  // Load and synchronize settings with canonical Electron main process filesystem store
  useEffect(() => {
    let isMounted = true
    const loadMainSettings = async () => {
      try {
        if (window.electronAPI?.getAppSettings) {
          const backendSettings = await window.electronAPI.getAppSettings()
          if (backendSettings && isMounted) {
            setSettings(backendSettings)
            if (backendSettings.language && backendSettings.language !== language) {
              setLanguage(backendSettings.language)
            }
            try {
              localStorage.setItem('onlyrag_app_settings', JSON.stringify(backendSettings))
            } catch {}
            return
          }
        }
        // If backend store has no settings yet, migrate existing localStorage settings to backend store
        const saved = localStorage.getItem('onlyrag_app_settings')
        if (saved && window.electronAPI?.saveAppSettings) {
          const parsed = JSON.parse(saved)
          await window.electronAPI.saveAppSettings(parsed)
        }
      } catch (err: any) {
        logger.error('AppLayout', `Failed initializing settings from filesystem store: ${err?.message}`)
      }
    }
    loadMainSettings()
    return () => {
      isMounted = false
    }
  }, [])

  const handleUpdateSettings = useCallback((newSettings: Partial<AppSettings>) => {
    // Applied before setSettings: React runs state updaters during the render phase, so
    // updating another component's state (I18nProvider) from inside one is a render-phase
    // update and React warns about it.
    if (newSettings.language && newSettings.language !== language) {
      setLanguage(newSettings.language)
    }

    setSettings((prev) => {
      const updated = { ...prev, ...newSettings }

      // Prompt overrides deliberately survive a model change. They used to be wiped here, because
      // the old per-family keys meant a prompt tuned for one family leaked onto another. Prompts
      // are now one per module and model-agnostic — adaptation happens through Ollama's reported
      // capabilities — so there is nothing to resynchronize, and wiping would only destroy the
      // user's edits. Resetting a prompt is an explicit action in the configuration modal.

      queueMicrotask(() => {
        try {
          localStorage.setItem('onlyrag_app_settings', JSON.stringify(updated))
        } catch (err: any) {
          logger.error('AppLayout', `Failed persisting app settings: ${err.message}`)
        }
        if (window.electronAPI?.saveAppSettings) {
          window.electronAPI.saveAppSettings(updated).catch((err: any) => {
            logger.error('AppLayout', `Failed saving app settings to main store: ${err?.message}`)
          })
        }
      })
      return updated
    })
  }, [language, setLanguage])

  const { diagnostics, refreshDiagnostics: runDiagnosticsScan } = useDiagnostics(settings, handleUpdateSettings)
  const {
    isDownloading: isModelDownloading,
    modelName: downloadingModelName,
    percent: downloadPercent,
    mbCompleted: downloadMbCompleted,
    mbTotal: downloadMbTotal,
    status: downloadStatus,
    lastCompletedModel,
    cancelDownload: cancelModelDownload,
  } = useModelDownloadProgress()

  // Immediately refresh diagnostics when a model completes downloading
  useEffect(() => {
    if (lastCompletedModel) {
      runDiagnosticsScan()
    }
  }, [lastCompletedModel, runDiagnosticsScan])

  const handleSelectTab = (tab: NavTab) => {
    setActiveTab(tab)
    try {
      localStorage.setItem('onlyrag_active_tab', tab)
    } catch (err: any) {
      logger.warn('AppLayout', `Failed saving active tab to localStorage: ${err?.message}`)
    }
    notifyTabChanged(tab)
  }

  const toggleLanguage = () => {
    const nextLang: Language = language === 'it' ? 'en' : 'it'
    setLanguage(nextLang)
    handleUpdateSettings({ language: nextLang })
  }

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden select-text">
      {/* Navigation Sidebar */}
      <aside className="w-64 glass-panel border-r border-slate-800 flex flex-col justify-between p-4 z-10 shrink-0">
        <div>
          {/* App Branding */}
          <div className="flex items-center justify-between px-2 py-3 mb-6 border-b border-slate-800/80">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-900/90 border border-cyan-500/30 flex items-center justify-center p-1.5 shadow-lg shadow-cyan-950/40 relative overflow-hidden group">
                <div className="absolute inset-0 bg-cyan-500/10 opacity-50 group-hover:opacity-100 transition-opacity" />
                <OnlyRagLogo className="w-full h-full object-contain relative z-10 drop-shadow-[0_0_8px_rgba(34,211,238,0.6)]" />
              </div>
              <div>
                <div className="font-bold text-base tracking-wide text-slate-100">{t('common.appName')}</div>
                <div className="text-[11px] text-cyan-400 font-medium">{t('common.tagline')}</div>
              </div>
            </div>

            {/* Language Switcher Badge */}
            <button
              type="button"
              onClick={toggleLanguage}
              title={t('sidebar.switchLanguage')}
              aria-label={t('sidebar.switchLanguage')}
              className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 rounded-lg text-[10px] font-bold text-cyan-400 flex items-center gap-1 transition-all focus-ring active:scale-95 shadow-sm"
            >
              <Globe className="w-3 h-3" />
              <span>{language.toUpperCase()}</span>
            </button>
          </div>

          {/* Navigation Links */}
          <nav
            className="space-y-1.5"
            role="tablist"
            aria-label="Main application navigation"
            onKeyDown={(e) => {
              const tabs: NavTab[] = ['ingestion', 'chat', 'translation', 'coding', 'settings']
              const currentIndex = tabs.indexOf(activeTab)
              if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                e.preventDefault()
                const nextIndex = (currentIndex + 1) % tabs.length
                handleSelectTab(tabs[nextIndex])
                document.getElementById(`tab-${tabs[nextIndex]}`)?.focus()
              } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                e.preventDefault()
                const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length
                handleSelectTab(tabs[prevIndex])
                document.getElementById(`tab-${tabs[prevIndex]}`)?.focus()
              }
            }}
          >
            <button
              type="button"
              role="tab"
              tabIndex={activeTab === 'ingestion' ? 0 : -1}
              aria-selected={activeTab === 'ingestion'}
              aria-controls="panel-ingestion"
              id="tab-ingestion"
              onClick={() => handleSelectTab('ingestion')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all focus-ring active:scale-95 ${
                activeTab === 'ingestion'
                  ? 'bg-slate-900 text-cyan-300 border-l-2 border-cyan-400 font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <FileText className="w-4 h-4" /> {t('navigation.ingestion')}
            </button>

            <button
              type="button"
              role="tab"
              tabIndex={activeTab === 'chat' ? 0 : -1}
              aria-selected={activeTab === 'chat'}
              aria-controls="panel-chat"
              id="tab-chat"
              onClick={() => handleSelectTab('chat')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all focus-ring active:scale-95 ${
                activeTab === 'chat'
                  ? 'bg-slate-900 text-cyan-300 border-l-2 border-cyan-400 font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <MessageSquare className="w-4 h-4" /> {t('navigation.chat')}
            </button>

            <button
              type="button"
              role="tab"
              tabIndex={activeTab === 'translation' ? 0 : -1}
              aria-selected={activeTab === 'translation'}
              aria-controls="panel-translation"
              id="tab-translation"
              onClick={() => handleSelectTab('translation')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all focus-ring active:scale-95 ${
                activeTab === 'translation'
                  ? 'bg-slate-900 text-cyan-300 border-l-2 border-cyan-400 font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <Languages className="w-4 h-4" /> {t('navigation.translation')}
            </button>

            <button
              type="button"
              role="tab"
              tabIndex={activeTab === 'coding' ? 0 : -1}
              aria-selected={activeTab === 'coding'}
              aria-controls="panel-coding"
              id="tab-coding"
              onClick={() => handleSelectTab('coding')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all focus-ring active:scale-95 ${
                activeTab === 'coding'
                  ? 'bg-slate-900 text-cyan-300 border-l-2 border-cyan-400 font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <Code className="w-4 h-4" /> {t('navigation.coding')}
            </button>

            <button
              type="button"
              role="tab"
              tabIndex={activeTab === 'settings' ? 0 : -1}
              aria-selected={activeTab === 'settings'}
              aria-controls="panel-settings"
              id="tab-settings"
              onClick={() => handleSelectTab('settings')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all focus-ring active:scale-95 ${
                activeTab === 'settings'
                  ? 'bg-slate-900 text-cyan-300 border-l-2 border-cyan-400 font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <Settings className="w-4 h-4" /> {t('navigation.settings')}
            </button>
          </nav>
        </div>

        {/* Hardware Status Widget & Diagnostics Button */}
        <div className="space-y-3 pt-4 border-t border-slate-800/80">
          <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Layers className={`w-3 h-3 ${diagnostics?.sidecar?.status === 'online' ? 'text-emerald-400' : 'text-rose-400'}`} />
                {t('sidebar.sidecarLanceDb')}
              </span>
              <span className={`font-semibold capitalize text-[10px] font-mono ${diagnostics?.sidecar?.status === 'online' ? 'text-emerald-400' : 'text-rose-400'}`}>
                {diagnostics?.sidecar?.status === 'online'
                  ? `${diagnostics.sidecar.documentsCount || 0} Docs`
                  : t('common.offline')}
              </span>
            </div>

            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Zap className={`w-3 h-3 ${diagnostics?.ollama.status === 'online' ? 'text-emerald-400' : 'text-rose-400'}`} />
                {t('sidebar.ollamaLocal')}
              </span>
              <span className={`font-semibold capitalize ${diagnostics?.ollama.status === 'online' ? 'text-emerald-400' : 'text-rose-400'}`}>
                {diagnostics?.ollama.status === 'online' ? t('common.online') : diagnostics?.ollama.status === 'checking' ? t('common.checking') : t('common.offline')}
              </span>
            </div>

            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Cpu className="w-3 h-3 text-cyan-400" />
                {t('sidebar.gpuVram')}
              </span>
              <span className="font-mono text-slate-200 text-[10px]">
                {diagnostics?.gpu.hasNvidiaGpu
                  ? `${diagnostics.gpu.vramUsedMB}/${diagnostics.gpu.vramTotalMB} MB`
                  : t('sidebar.cpuOnly')}
              </span>
            </div>

            {/* Hybrid Offloading RAM metric (used / remaining) */}
            <div
              className="flex items-center justify-between text-[11px]"
              title={
                diagnostics?.memory
                  ? t('sidebar.hybridRamTooltip')
                      .replace('{used}', String(diagnostics.memory.usedRAMGB))
                      .replace('{free}', String(diagnostics.memory.freeRAMGB))
                      .replace('{total}', String(diagnostics.memory.totalRAMGB))
                      .replace('{percent}', String(diagnostics.memory.ramUsagePercent))
                  : 'Offloading Ibrido su RAM di Sistema (Hybrid GPU + RAM)'
              }
            >
              <span className="text-slate-400 flex items-center gap-1.5">
                <HardDrive className="w-3 h-3 text-sky-400" />
                {t('sidebar.systemRam')}
              </span>
              <span className="font-mono text-slate-200 text-[10px]">
                {diagnostics?.memory
                  ? `${diagnostics.memory.usedRAMGB}/${diagnostics.memory.freeRAMGB} GB`
                  : '--/-- GB'}
              </span>
            </div>
          </div>

          {diagnostics?.ollama.status !== 'online' && (
            <button
              type="button"
              onClick={async () => {
                if (window.electronAPI?.installOrLaunchOllama) {
                  await window.electronAPI.installOrLaunchOllama()
                  runDiagnosticsScan()
                }
              }}
              aria-label={t('sidebar.installLaunchOllama')}
              className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-semibold rounded-xl transition-all focus-ring active:scale-95 flex items-center justify-center gap-1.5 shadow-md shadow-cyan-950/40"
            >
              <Zap className="w-3.5 h-3.5 fill-current" /> {t('sidebar.installLaunchOllama')}
            </button>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsWizardOpen(true)}
              aria-label={t('settings.hardwareWizard')}
              title={t('settings.hardwareWizard')}
              className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/40 text-slate-300 hover:text-cyan-300 font-medium rounded-xl transition-all focus-ring active:scale-95"
            >
              <Zap className="w-4 h-4 text-cyan-400 fill-cyan-400/20" />
            </button>

            <button
              type="button"
              onClick={() => setIsDiagnosticsDrawerOpen(true)}
              aria-label={t('sidebar.logsConsole')}
              className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-xs text-slate-300 font-medium rounded-xl transition-all focus-ring active:scale-95 flex items-center justify-center gap-1.5"
            >
              <Terminal className="w-3.5 h-3.5 text-cyan-400" />
              <span className="truncate">{t('sidebar.logsConsole')}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsAboutModalOpen(true)}
              aria-label={t('sidebar.contributionsAndInfo')}
              title={t('sidebar.contributionsAndInfo')}
              className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/40 text-slate-300 hover:text-cyan-300 font-medium rounded-xl transition-all focus-ring active:scale-95"
            >
              <Info className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main App Content View */}
      <main className="flex-1 h-full flex flex-col overflow-hidden relative">
        <div id="panel-ingestion" role="tabpanel" aria-labelledby="tab-ingestion" className={`h-full w-full flex flex-col ${activeTab === 'ingestion' ? '' : 'hidden'}`}>
          {visitedTabs.has('ingestion') && (
            <Suspense fallback={<ViewChunkFallback />}>
              <IngestionView settings={settings} diagnostics={diagnostics} onUpdateSettings={handleUpdateSettings} />
            </Suspense>
          )}
        </div>
        <div id="panel-chat" role="tabpanel" aria-labelledby="tab-chat" className={`h-full w-full flex flex-col ${activeTab === 'chat' ? '' : 'hidden'}`}>
          {visitedTabs.has('chat') && (
            <Suspense fallback={<ViewChunkFallback />}>
              <ChatView settings={settings} diagnostics={diagnostics} onUpdateSettings={handleUpdateSettings} />
            </Suspense>
          )}
        </div>
        <div id="panel-translation" role="tabpanel" aria-labelledby="tab-translation" className={`h-full w-full flex flex-col ${activeTab === 'translation' ? '' : 'hidden'}`}>
          {visitedTabs.has('translation') && (
            <Suspense fallback={<ViewChunkFallback />}>
              <TranslationView settings={settings} diagnostics={diagnostics} onUpdateSettings={handleUpdateSettings} />
            </Suspense>
          )}
        </div>
        <div id="panel-coding" role="tabpanel" aria-labelledby="tab-coding" className={`h-full w-full flex flex-col ${activeTab === 'coding' ? '' : 'hidden'}`}>
          {visitedTabs.has('coding') && (
            <Suspense fallback={<ViewChunkFallback />}>
              <CodingAgentView settings={settings} onUpdateSettings={handleUpdateSettings} diagnostics={diagnostics} />
            </Suspense>
          )}
        </div>
        <div id="panel-settings" role="tabpanel" aria-labelledby="tab-settings" className={`h-full w-full flex flex-col ${activeTab === 'settings' ? '' : 'hidden'}`}>
          {visitedTabs.has('settings') && (
            <Suspense fallback={<ViewChunkFallback />}>
              <SettingsView
                diagnostics={diagnostics}
                settings={settings}
                onUpdateSettings={handleUpdateSettings}
                onRefreshDiagnostics={runDiagnosticsScan}
                onOpenAboutModal={() => setIsAboutModalOpen(true)}
                onOpenWizard={() => setIsWizardOpen(true)}
              />
            </Suspense>
          )}
        </div>
      </main>

      {/* Diagnostics Drawer Modal */}
      <DiagnosticsDrawer
        isOpen={isDiagnosticsDrawerOpen}
        onClose={() => setIsDiagnosticsDrawerOpen(false)}
        diagnostics={diagnostics}
        onRefreshDiagnostics={runDiagnosticsScan}
      />

      {/* About & Contributions Modal */}
      <AboutModal
        isOpen={isAboutModalOpen}
        onClose={() => setIsAboutModalOpen(false)}
      />

      {/* Complete Hardware & Model Setup Wizard Modal */}
      <HardwareSetupWizardModal
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        diagnostics={diagnostics}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        onRefreshDiagnostics={runDiagnosticsScan}
        isInitialSetup={!settings.hasCompletedInitialSetup}
      />

      {/* Persistent Background Download Progress Banner / Pill */}
      {(isModelDownloading || lastCompletedModel) && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-6 z-40 max-w-sm bg-slate-900/95 backdrop-blur-md border border-cyan-500/40 rounded-2xl p-3.5 shadow-2xl shadow-cyan-950/40 flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-4 duration-300"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`p-2 rounded-xl shrink-0 ${
                  isModelDownloading ? 'bg-cyan-500/20 text-cyan-400 animate-pulse' : 'bg-emerald-500/20 text-emerald-400'
                }`}
              >
                {isModelDownloading ? <Download className="w-4 h-4" /> : <Check className="w-4 h-4" />}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-200 truncate">
                  {isModelDownloading ? (
                    <>
                      {t('common.download')}: <span className="text-cyan-400 font-mono">{downloadingModelName}</span>
                    </>
                  ) : (
                    <>
                      {t('common.done')}: <span className="text-emerald-400 font-mono">{lastCompletedModel}</span>
                    </>
                  )}
                </p>
                <p className="text-[11px] text-slate-400 truncate">
                  {isModelDownloading
                    ? `${downloadPercent}% • ${downloadMbCompleted} / ${downloadMbTotal} MB (${downloadStatus || 'in corso'})`
                    : 'Modello pronto all\'uso'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {!isWizardOpen && (
                <button
                  type="button"
                  onClick={() => setIsWizardOpen(true)}
                  aria-label={t('common.viewDetails')}
                  className="px-2.5 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-xs font-medium rounded-lg transition-all focus-ring active:scale-95"
                >
                  {t('common.viewDetails')}
                </button>
              )}
              {isModelDownloading && (
                <button
                  type="button"
                  onClick={cancelModelDownload}
                  title={t('common.cancel')}
                  aria-label={t('common.cancel')}
                  className="p-1 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 rounded-lg transition-all focus-ring active:scale-95"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {isModelDownloading && (
            <div className="w-full bg-slate-950/80 rounded-full h-1.5 overflow-hidden border border-slate-800">
              <div
                className="bg-gradient-to-r from-cyan-500 to-blue-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${downloadPercent}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
