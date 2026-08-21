import React, { useState, useRef, useEffect } from 'react'
import { Code, ChevronRight, Sparkles, Compass, Cpu, CheckCircle2, AlertCircle, Wrench } from 'lucide-react'
import { AppSettings } from '../../types'
import { ComplexityRouteResult } from '../../services/complexityRouterService'
import { ModelBadge } from '../common/ModelBadge'
import { useTranslation } from '../../i18n'

interface CodingHeaderProps {
  guestOsInfo: any
  settings?: AppSettings
  onUpdateSettings?: (newSettings: Partial<AppSettings>) => void
  activeSkills?: string[]
  /** Routed complexity for the last submitted (or, while idle, currently drafted) prompt — computed once by the parent. */
  complexity: ComplexityRouteResult
  /** Model actually driving the agent: complexity.modelName when routing is on, otherwise the fixed coding model. */
  activeModel: string
}

export const CodingHeader: React.FC<CodingHeaderProps> = ({
  guestOsInfo,
  settings,
  onUpdateSettings,
  activeSkills = [],
  complexity,
  activeModel,
}) => {
  const { t } = useTranslation()
  const [isSystemPopoverOpen, setIsSystemPopoverOpen] = useState<boolean>(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  const isAutoHubEnabled = settings?.autoInstallHubSkills !== 'disabled'

  const toggleAutoHub = () => {
    if (onUpdateSettings) {
      onUpdateSettings({
        autoInstallHubSkills: isAutoHubEnabled ? 'disabled' : 'auto',
        enableSkillRouter: !isAutoHubEnabled,
      })
    }
  }

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

      {/* Right: Actions, System Popover, Skills & Model Badge */}
      <div className="flex items-center gap-2 text-xs">
        {/* Quick Toggle for Auto-Discovery Skill Hub */}
        <button
          type="button"
          onClick={toggleAutoHub}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[10px] font-sans font-bold border transition-all cursor-pointer shadow-sm ${
            isAutoHubEnabled
              ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/60'
              : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:bg-slate-850'
          }`}
          title={isAutoHubEnabled ? t('coding.autoHubOnTitle') : t('coding.autoHubOffTitle')}
        >
          <Compass className={`w-3 h-3 ${isAutoHubEnabled ? 'text-emerald-400' : 'text-slate-400'}`} />
          <span>Auto-Hub: {isAutoHubEnabled ? 'ON' : 'OFF'}</span>
        </button>

        {/* Active Skills Badge */}
        {activeSkills.length > 0 && (
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 bg-cyan-950/40 border border-cyan-500/30 rounded-xl text-[10px] text-cyan-300 font-sans shadow-sm"
            title={`${t('coding.activeSkillsTitle')} ${activeSkills.join(', ')}`}
          >
            <Sparkles className="w-3 h-3 text-cyan-400 shrink-0" />
            <span className="font-semibold text-slate-300 hidden md:inline">{t('coding.skillsInUse')}</span>
            <span className="px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-200 font-mono text-[9px] font-bold border border-cyan-500/30">
              {activeSkills.length}
            </span>
          </div>
        )}

        {/* Compact System & Toolchain Status Popover */}
        <div className="relative" ref={popoverRef}>
          <button
            type="button"
            onClick={() => setIsSystemPopoverOpen((prev) => !prev)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[10px] font-sans font-medium border transition-colors shadow-sm cursor-pointer ${
              allCoreToolsAvailable
                ? 'bg-slate-900/80 hover:bg-slate-850 border-slate-800 text-slate-300'
                : 'bg-amber-950/40 hover:bg-amber-900/40 border-amber-500/40 text-amber-300'
            }`}
            title="Visualizza lo stato dei tool di sistema e dell'hardware"
          >
            {allCoreToolsAvailable ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            ) : (
              <AlertCircle className="w-3 h-3 text-amber-400" />
            )}
            <span className="hidden sm:inline">System</span>
            <Cpu className="w-3 h-3 text-slate-400" />
          </button>

          {isSystemPopoverOpen && (
            <div className="absolute right-0 top-full mt-2 w-64 p-3 bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl z-50 text-xs font-sans space-y-2.5 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="font-bold text-slate-200 flex items-center gap-1.5 text-xs">
                  <Wrench className="w-3.5 h-3.5 text-cyan-400" /> Toolchain & Runtime
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  {guestOsInfo?.platform || 'Windows'}
                </span>
              </div>

              {/* Tool list grid */}
              <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono">
                <div className="flex items-center justify-between px-2 py-1 bg-slate-950/80 rounded-lg border border-slate-800">
                  <span className="text-slate-400">Git</span>
                  <span className={`text-[10px] font-bold ${hasGit ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {hasGit ? 'OK' : 'N/A'}
                  </span>
                </div>
                <div className="flex items-center justify-between px-2 py-1 bg-slate-950/80 rounded-lg border border-slate-800">
                  <span className="text-slate-400">Node</span>
                  <span className={`text-[10px] font-bold ${hasNode ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {hasNode ? 'OK' : 'N/A'}
                  </span>
                </div>
                <div className="flex items-center justify-between px-2 py-1 bg-slate-950/80 rounded-lg border border-slate-800">
                  <span className="text-slate-400">Python</span>
                  <span className={`text-[10px] font-bold ${hasPy ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {hasPy ? 'OK' : 'N/A'}
                  </span>
                </div>
                <div className="flex items-center justify-between px-2 py-1 bg-slate-950/80 rounded-lg border border-slate-800">
                  <span className="text-slate-400">Ollama</span>
                  <span className={`text-[10px] font-bold ${hasOllama ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {hasOllama ? 'OK' : 'OFF'}
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
                    <span className="text-slate-400">UV</span>
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

        {/* Model Badge with Complexity Router Tier */}
        <ModelBadge
          modelName={activeModel}
          tier={settings?.useComplexityRouting ? complexity.tier : undefined}
          tierName={complexity.tierName}
          tooltip={settings?.useComplexityRouting ? `Complexity Router: ${complexity.tierName} (${activeModel}) — ${complexity.reasoning}` : `Coding Model: ${activeModel}`}
        />
      </div>
    </header>
  )
}
