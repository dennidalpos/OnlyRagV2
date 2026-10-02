import React from 'react'
import { Code, Sparkles, CheckCircle2, AlertCircle, Wrench, Sliders, Shield } from 'lucide-react'
import { AppSettings, type GuestOsInfo } from '../../types'

import { QuickModelSelector } from '../common/QuickModelSelector'
import { useTranslation } from '../../i18n'

interface CodingHeaderProps {
  guestOsInfo: GuestOsInfo | null
  settings?: AppSettings
  onUpdateSettings?: (newSettings: Partial<AppSettings>) => void
  activeSkills?: string[]
  installedModels?: string[]
  /** Model driving the agent: the configured coding model, or the live one while executing. */
  activeModel: string
  onOpenDiagnosticsModal?: () => void
  onOpenSkillHubModal?: () => void
  onOpenPromptModal?: () => void
  onOpenPermissionsModal?: () => void
}

export const CodingHeader: React.FC<CodingHeaderProps> = ({
  guestOsInfo,
  settings,
  onUpdateSettings,
  activeSkills = [],
  installedModels = [],
  activeModel,
  onOpenDiagnosticsModal,
  onOpenSkillHubModal,
  onOpenPromptModal,
  onOpenPermissionsModal,
}) => {
  const { t } = useTranslation()
  const hasGit = guestOsInfo?.tools.git
  const hasNode = guestOsInfo?.tools.node
  const hasOllama = guestOsInfo?.tools.ollama

  const allCoreToolsAvailable = hasGit === true && hasNode === true && hasOllama === true

  return (
    <header className="p-4 border-b border-slate-800 bg-slate-900/80 flex items-center justify-between z-10 shrink-0 select-text font-sans">
      {/* Left: Module Branding */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shadow-sm">
          <Code className="w-5 h-5 text-cyan-400" />
        </div>
        <div>
          <h1 className="font-bold text-slate-100 text-sm tracking-wide">{t('coding.headerTitle')}</h1>
          <p className="text-[11px] text-amber-300" title={t('modelBadges.experimentalTooltip')}>
            {t('modelBadges.experimental')}
          </p>
        </div>
      </div>

      {/* Right: Quick Model Selector, System Prompt, Skills & Toolchain Popover */}
      <div className="flex items-center gap-2.5 text-xs">
        <button
          type="button"
          onClick={onOpenPermissionsModal}
          aria-label={t('settings.agentPermissionsOpen')}
          title={t('settings.agentPermissionsOpen')}
          className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/50 text-cyan-300 text-xs font-semibold rounded-xl focus-ring flex items-center gap-1.5"
        >
          <Shield className="w-3.5 h-3.5" /> <span className="hidden sm:inline">{t('settings.agentPermissionsOpen')}</span>
        </button>
        {/* Quick Coding Model Selector */}
        <QuickModelSelector
          currentModel={activeModel || settings?.codingModel || ''}
          installedModels={installedModels}
          onSelectModel={(newModel) => {
            onUpdateSettings?.({
              codingModel: newModel,
            })
          }}
          icon={Code}
          featureLabel="AI Coding Agent"
        />

        {/* System Prompt Customization Trigger */}
        {onOpenPromptModal && (
          <button
            type="button"
            onClick={onOpenPromptModal}
            aria-label={t('common.systemPrompt')}
            title={t('common.systemPrompt')}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/50 text-cyan-300 text-xs font-semibold rounded-xl transition-all focus-ring active:scale-95 flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">{t('common.systemPrompt')}</span>
          </button>
        )}

        {/* Active Skills Badge / Trigger */}
        <button
          type="button"
          onClick={onOpenSkillHubModal}
          aria-label={activeSkills.length > 0 ? `${t('coding.activeSkillsTitle')}: ${activeSkills.join(', ')}` : t('uiShell.openSkillHub')}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-sans font-bold border transition-all focus-ring cursor-pointer shadow-sm ${
            activeSkills.length > 0
              ? 'bg-cyan-950/60 border-cyan-500/40 text-cyan-300 hover:bg-cyan-900/60'
              : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:bg-slate-850 hover:text-slate-200'
          }`}
          title={activeSkills.length > 0 ? `${t('coding.activeSkillsTitle')} ${activeSkills.join(', ')}` : t('uiShell.openSkillHub')}
        >
          <Sparkles className={`w-3 h-3 ${activeSkills.length > 0 ? 'text-cyan-400' : 'text-slate-400'}`} />
          <span>Skills</span>
          {activeSkills.length > 0 && (
            <span className="px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-200 font-mono text-[9px] font-bold border border-cyan-500/30">
              {activeSkills.length}
            </span>
          )}
        </button>

        {/* System & Toolchain Status Trigger */}
        <div>
          <button
            type="button"
            onClick={onOpenDiagnosticsModal}
            aria-label={t('uiShell.toolchainStatus')}
            title={t('uiShell.toolchainStatusHint')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-medium border transition-colors focus-ring ${
              allCoreToolsAvailable
                ? 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-100/10 hover:border-slate-700'
                : 'bg-amber-950/40 border-amber-800/60 text-amber-300 hover:bg-amber-900/50'
            }`}
          >
            <Wrench className={`w-3 h-3 ${allCoreToolsAvailable ? 'text-cyan-400' : 'text-amber-400'}`} />
            <span className="font-mono text-[10px]">OS Tools</span>
            {allCoreToolsAvailable ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <AlertCircle className="w-3 h-3 text-amber-400 animate-pulse" />}
          </button>
        </div>
      </div>
    </header>
  )
}
