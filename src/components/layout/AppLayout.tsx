import React, { useState, useCallback } from 'react'
import { AppSettings } from '../../types'
import {
  Layers,
  MessageSquare,
  Languages,
  Code,
  Settings,
  Zap,
  Cpu,
  Terminal,
  Info,
  Globe,
} from 'lucide-react'
import { SettingsView } from '../settings/SettingsView'
import { IngestionView } from '../ingestion/IngestionView'
import { ChatView } from '../chat/ChatView'
import { TranslationView } from '../translation/TranslationView'
import { CodingAgentView } from '../coding/CodingAgentView'
import { DiagnosticsDrawer } from '../diagnostics/DiagnosticsDrawer'
import { AboutModal } from '../common/AboutModal'
import { OnlyRagLogo } from '../common/OnlyRagLogo'
import { HardwareSetupWizardModal } from '../common/HardwareSetupWizardModal'
import { useDiagnostics } from '../../hooks/useDiagnostics'
import { notifyTabChanged } from '../../hooks/useIngestedDocuments'
import { useTranslation, Language } from '../../i18n'
import { logger } from '../../lib/logger'

export type NavTab = 'ingestion' | 'chat' | 'translation' | 'coding' | 'settings'

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
    }
  })

  // Auto-launch initial setup wizard on first start
  React.useEffect(() => {
    if (!settings.hasCompletedInitialSetup && !settings.defaultModel) {
      setIsWizardOpen(true)
    }
  }, [settings.hasCompletedInitialSetup, settings.defaultModel])

  const handleUpdateSettings = useCallback((newSettings: Partial<AppSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings }
      if (newSettings.language && newSettings.language !== language) {
        setLanguage(newSettings.language)
      }
      // Schedule persistence outside React's render cycle
      queueMicrotask(() => {
        try {
          localStorage.setItem('onlyrag_app_settings', JSON.stringify(updated))
        } catch (err: any) {
          logger.error('AppLayout', `Failed persisting app settings: ${err.message}`)
        }
      })
      return updated
    })
  }, [language, setLanguage])

  const { diagnostics, refreshDiagnostics: runDiagnosticsScan } = useDiagnostics(settings, handleUpdateSettings)

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
              role="tab"
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
              <Layers className="w-4 h-4" /> {t('navigation.ingestion')}
            </button>

            <button
              role="tab"
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
              role="tab"
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
              role="tab"
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
              role="tab"
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
          </div>

          {diagnostics?.ollama.status !== 'online' && (
            <button
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
              onClick={() => setIsWizardOpen(true)}
              aria-label={t('settings.hardwareWizard')}
              title={t('settings.hardwareWizard')}
              className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/40 text-slate-300 hover:text-cyan-300 font-medium rounded-xl transition-all focus-ring active:scale-95"
            >
              <Zap className="w-4 h-4 text-cyan-400 fill-cyan-400/20" />
            </button>

            <button
              onClick={() => setIsDiagnosticsDrawerOpen(true)}
              aria-label={t('sidebar.logsConsole')}
              className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-xs text-slate-300 font-medium rounded-xl transition-all focus-ring active:scale-95 flex items-center justify-center gap-1.5"
            >
              <Terminal className="w-3.5 h-3.5 text-cyan-400" />
              <span className="truncate">{t('sidebar.logsConsole')}</span>
            </button>

            <button
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
          <IngestionView settings={settings} onUpdateSettings={handleUpdateSettings} />
        </div>
        <div id="panel-chat" role="tabpanel" aria-labelledby="tab-chat" className={`h-full w-full flex flex-col ${activeTab === 'chat' ? '' : 'hidden'}`}>
          <ChatView settings={settings} diagnostics={diagnostics} onUpdateSettings={handleUpdateSettings} />
        </div>
        <div id="panel-translation" role="tabpanel" aria-labelledby="tab-translation" className={`h-full w-full flex flex-col ${activeTab === 'translation' ? '' : 'hidden'}`}>
          <TranslationView settings={settings} onUpdateSettings={handleUpdateSettings} />
        </div>
        <div id="panel-coding" role="tabpanel" aria-labelledby="tab-coding" className={`h-full w-full flex flex-col ${activeTab === 'coding' ? '' : 'hidden'}`}>
          <CodingAgentView settings={settings} onUpdateSettings={handleUpdateSettings} diagnostics={diagnostics} />
        </div>
        <div id="panel-settings" role="tabpanel" aria-labelledby="tab-settings" className={`h-full w-full flex flex-col ${activeTab === 'settings' ? '' : 'hidden'}`}>
          <SettingsView
            diagnostics={diagnostics}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onRefreshDiagnostics={runDiagnosticsScan}
            onOpenAboutModal={() => setIsAboutModalOpen(true)}
            onOpenWizard={() => setIsWizardOpen(true)}
          />
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
    </div>
  )
}
