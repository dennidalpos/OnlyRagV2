import React, { useState, useRef, useEffect } from 'react'
import { Code, ChevronRight, Sparkles, Cpu, CheckCircle2, AlertCircle, Wrench, Sliders } from 'lucide-react'
import { AppSettings } from '../../types'
import { ComplexityRouteResult, ModelTier } from '../../services/complexityRouterService'
import { QuickModelSelector } from '../common/QuickModelSelector'
import { useTranslation } from '../../i18n'

interface CodingHeaderProps {
  guestOsInfo: any
  settings?: AppSettings
  onUpdateSettings?: (newSettings: Partial<AppSettings>) => void
  activeSkills?: string[]
  installedModels?: string[]
  /** Routed complexity for the last submitted (or, while idle, currently drafted) prompt — computed once by the parent. */
  complexity: ComplexityRouteResult
  /** Model actually driving the agent: complexity.modelName when routing is on, otherwise the fixed coding model. */
  activeModel: string
  /** Live executing tier during agent turns (optional) */
  activeTier?: ModelTier | null
  onOpenDiagnosticsModal?: () => void
  onOpenSkillHubModal?: () => void
  onOpenPromptModal?: () => void
}

export const CodingHeader: React.FC<CodingHeaderProps> = ({
  guestOsInfo,
  settings,
  onUpdateSettings,
  activeSkills = [],
  installedModels = [],
  complexity,
  activeModel,
  activeTier,
  onOpenDiagnosticsModal,
  onOpenSkillHubModal,
  onOpenPromptModal,
}) => {
  const { t } = useTranslation()
  const [isSystemPopoverOpen, setIsSystemPopoverOpen] = useState<boolean>(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Handle outside click to close popover
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsSystemPopoverOpen(false)
      }
    }
    if (isSystemPopoverOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isSystemPopoverOpen])

  const hasGit = guestOsInfo?.tools?.git ?? guestOsInfo?.hasGit
  const hasNode = guestOsInfo?.tools?.node ?? guestOsInfo?.hasNode
  const hasPy = guestOsInfo?.tools?.python ?? guestOsInfo?.hasPython
  const hasOllama = guestOsInfo?.tools?.ollama ?? guestOsInfo?.hasOllama
  const hasDocker = guestOsInfo?.tools?.docker
  const hasUv = guestOsInfo?.tools?.uv
  const hasBun = guestOsInfo?.tools?.bun

  const allCoreToolsAvailable = hasGit !== false && hasNode !== false && hasOllama !== false

  return (
    <header className="h-12 px-4 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur flex items-center justify-between z-30 shrink-0 select-text font-sans">
      {/* Left: App & Module Breadcrumb */}
      <div className="flex items-center gap-2 text-xs">
        <div className="w-6 h-6 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shadow-sm">
          <Code className="w-3.5 h-3.5 text-cyan-400" />
        </div>
        <span className="font-bold text-slate-100">{t('common.appName')}</span>
        <ChevronRight className="w-3 h-3 text-slate-600" />
        <span className="text-slate-400 font-medium truncate max-w-xs">{t('coding.headerTitle')}</span>
      </div>

      {/* Right: Quick Model Selector, System Prompt, Skills & Toolchain Popover */}
      <div className="flex items-center gap-2 text-xs">
        {/* Quick Coding Model Selector with Fallback */}
        <QuickModelSelector
          currentModel={activeModel || settings?.codingModel || 'qwen2.5-coder:7b'}
          fallbackModel={settings?.codingFallbackModel}
          installedModels={installedModels}
          presetOptions={[
            'qwen2.5-coder:7b',
            'qwen3:8b',
            'qwen2.5-coder:14b',
            'qwen3:14b',
            'gpt-oss:20b',
            'codestral:22b',
            'qwen2.5-coder:32b',
            'deepseek-coder:6.7b',
            'llama3.1:8b',
          ]}
          onSelectModel={(newModel) => {
            onUpdateSettings?.({
              codingModel: newModel,
            })
          }}
          onSelectFallbackModel={(fallback) => {
            onUpdateSettings?.({
              codingFallbackModel: fallback,
            })
          }}
          icon={Code}
          featureLabel="AI Coding Agent"
          variant="cyan"
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
          aria-label={activeSkills.length > 0 ? `${t('coding.activeSkillsTitle')}: ${activeSkills.join(', ')}` : 'Apri Skill Hub & Marketplace'}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-sans font-bold border transition-all focus-ring cursor-pointer shadow-sm ${
            activeSkills.length > 0
              ? 'bg-cyan-950/60 border-cyan-500/40 text-cyan-300 hover:bg-cyan-900/60'
              : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:bg-slate-850 hover:text-slate-200'
          }`}
          title={activeSkills.length > 0 ? `${t('coding.activeSkillsTitle')} ${activeSkills.join(', ')}` : 'Apri Skill Hub & Marketplace'}
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
        <div className="relative" ref={popoverRef}>
          <button
            type="button"
            onClick={() => setIsSystemPopoverOpen(!isSystemPopoverOpen)}
            aria-label="Stato Toolchain Host"
            title="Stato Toolchain Host (Git, Node, Python, Ollama)"
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-medium border transition-colors focus-ring ${
              allCoreToolsAvailable
                ? 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-100/10 hover:border-slate-700'
                : 'bg-amber-950/40 border-amber-800/60 text-amber-300 hover:bg-amber-900/50'
            }`}
          >
            <Wrench className={`w-3 h-3 ${allCoreToolsAvailable ? 'text-cyan-400' : 'text-amber-400'}`} />
            <span className="font-mono text-[10px]">OS Tools</span>
            {allCoreToolsAvailable ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            ) : (
              <AlertCircle className="w-3 h-3 text-amber-400 animate-pulse" />
            )}
          </button>

          {/* Toolchain Flyout Card */}
          {isSystemPopoverOpen && (
            <div className="absolute right-0 mt-2 w-64 rounded-xl bg-slate-950 border border-slate-800 shadow-2xl p-3 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
                <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-cyan-400" /> Toolchain di Sistema
                </span>
                <button
                  type="button"
                  onClick={onOpenDiagnosticsModal}
                  className="text-[10px] text-cyan-400 hover:underline cursor-pointer"
                >
                  Dettagli
                </button>
              </div>

              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex items-center justify-between px-2 py-1 bg-slate-900/60 rounded-lg border border-slate-850">
                  <span className="text-slate-400">Git</span>
                  <span className={`text-[10px] font-bold ${hasGit ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {hasGit ? 'OK' : 'Mancante'}
                  </span>
                </div>
                <div className="flex items-center justify-between px-2 py-1 bg-slate-900/60 rounded-lg border border-slate-850">
                  <span className="text-slate-400">Node</span>
                  <span className={`text-[10px] font-bold ${hasNode ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {hasNode ? 'OK' : 'Mancante'}
                  </span>
                </div>
                <div className="flex items-center justify-between px-2 py-1 bg-slate-900/60 rounded-lg border border-slate-850">
                  <span className="text-slate-400">Python</span>
                  <span className={`text-[10px] font-bold ${hasPy ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {hasPy ? 'OK' : 'Mancante'}
                  </span>
                </div>
                <div className="flex items-center justify-between px-2 py-1 bg-slate-900/60 rounded-lg border border-slate-850">
                  <span className="text-slate-400">Ollama</span>
                  <span className={`text-[10px] font-bold ${hasOllama ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {hasOllama ? 'OK' : 'Mancante'}
                  </span>
                </div>
                {hasDocker !== undefined && (
                  <div className="flex items-center justify-between px-2 py-1 bg-slate-950/80 rounded-lg border border-slate-800">
                    <span className="text-slate-400">Docker</span>
                    <span className={`text-[10px] font-bold ${hasDocker ? 'text-emerald-400' : 'text-slate-500'}`}>
                      {hasDocker ? 'OK' : 'N/A'}
                    </span>
                  </div>
                )}
                {hasUv !== undefined && (
                  <div className="flex items-center justify-between px-2 py-1 bg-slate-950/80 rounded-lg border border-slate-800">
                    <span className="text-slate-400">Uv</span>
                    <span className={`text-[10px] font-bold ${hasUv ? 'text-emerald-400' : 'text-slate-500'}`}>
                      {hasUv ? 'OK' : 'N/A'}
                    </span>
                  </div>
                )}
                {hasBun !== undefined && (
                  <div className="flex items-center justify-between px-2 py-1 bg-slate-950/80 rounded-lg border border-slate-800">
                    <span className="text-slate-400">Bun</span>
                    <span className={`text-[10px] font-bold ${hasBun ? 'text-emerald-400' : 'text-slate-500'}`}>
                      {hasBun ? 'OK' : 'N/A'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
