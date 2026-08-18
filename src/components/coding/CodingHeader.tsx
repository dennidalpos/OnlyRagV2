import React from 'react'
import { Code, ChevronRight, Cpu, Sparkles, Compass } from 'lucide-react'
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

  const isAutoHubEnabled = settings?.autoInstallHubSkills !== 'disabled'

  const toggleAutoHub = () => {
    if (onUpdateSettings) {
      onUpdateSettings({
        autoInstallHubSkills: isAutoHubEnabled ? 'disabled' : 'auto',
        enableSkillRouter: !isAutoHubEnabled,
      })
    }
  }

  return (
    <div className="h-12 px-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between z-10 shrink-0 select-text font-sans">
      {/* Left: Project & Module Title */}
      <div className="flex items-center gap-2 text-xs">
        <div className="w-6 h-6 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
          <Code className="w-3.5 h-3.5 text-cyan-400" />
        </div>
        <span className="font-bold text-slate-100">{t('common.appName')}</span>
        <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
        <span className="text-slate-400 font-medium truncate max-w-xs">{t('coding.headerTitle')}</span>
      </div>

      {/* Center / Right: Hardware Specs, Active Skills Badge, Model Badge */}
      <div className="flex items-center gap-2.5 text-xs">
        {/* Quick Toggle for Auto-Discovery Skill Hub */}
        <button
          type="button"
          onClick={toggleAutoHub}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-xl text-[10px] font-sans font-bold border transition-all cursor-pointer shadow-sm ${
            isAutoHubEnabled
              ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/60'
              : 'bg-slate-900/80 border-slate-700/60 text-slate-400 hover:bg-slate-800/80'
          }`}
          title={isAutoHubEnabled ? t('coding.autoHubOnTitle') : t('coding.autoHubOffTitle')}
        >
          <Compass className={`w-3 h-3 ${isAutoHubEnabled ? 'text-emerald-400' : 'text-slate-400'}`} />
          <span>Auto-Hub: {isAutoHubEnabled ? 'ON' : 'OFF'}</span>
        </button>

        {/* Active Skills Pill Badge */}
        {activeSkills.length > 0 && (
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 bg-cyan-950/40 border border-cyan-500/30 rounded-xl text-[10px] text-cyan-300 font-sans shadow-sm animate-in fade-in duration-200"
            title={`${t('coding.activeSkillsTitle')} ${activeSkills.join(', ')}`}
          >
            <Sparkles className="w-3 h-3 text-cyan-400 shrink-0" />
            <span className="font-semibold text-slate-300 hidden md:inline">{t('coding.skillsInUse')}</span>
            <div className="flex items-center gap-1">
              {activeSkills.map((sk) => (
                <span
                  key={sk}
                  className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono text-[9px] font-bold border border-cyan-500/30"
                >
                  {sk}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Active Tools Badges */}
        {(guestOsInfo?.tools || guestOsInfo?.hasGit !== undefined) && (
          <div className="hidden sm:flex items-center gap-1 font-mono bg-slate-900/80 px-2.5 py-1 rounded-xl border border-slate-800 text-[9px] font-bold">
            <span className={`px-1.5 py-0.2 rounded ${(guestOsInfo.tools?.git ?? guestOsInfo.hasGit) ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60' : 'bg-slate-800/60 text-slate-400'}`}>GIT</span>
            <span className={`px-1.5 py-0.2 rounded ${(guestOsInfo.tools?.node ?? guestOsInfo.hasNode) ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60' : 'bg-slate-800/60 text-slate-400'}`}>NODE</span>
            <span className={`px-1.5 py-0.2 rounded ${(guestOsInfo.tools?.python ?? guestOsInfo.hasPython) ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60' : 'bg-slate-800/60 text-slate-400'}`}>PY</span>
            <span className={`px-1.5 py-0.2 rounded ${(guestOsInfo.tools?.ollama ?? guestOsInfo.hasOllama) ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60' : 'bg-slate-800/60 text-slate-400'}`}>OLLAMA</span>
            {guestOsInfo.tools?.docker !== undefined && (
              <span className={`px-1.5 py-0.2 rounded ${guestOsInfo.tools.docker ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60' : 'bg-slate-800/60 text-slate-400'}`}>DOCKER</span>
            )}
            {guestOsInfo.tools?.uv !== undefined && (
              <span className={`px-1.5 py-0.2 rounded ${guestOsInfo.tools.uv ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60' : 'bg-slate-800/60 text-slate-400'}`}>UV</span>
            )}
            {guestOsInfo.tools?.bun !== undefined && (
              <span className={`px-1.5 py-0.2 rounded ${guestOsInfo.tools.bun ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60' : 'bg-slate-800/60 text-slate-400'}`}>BUN</span>
            )}
          </div>
        )}

        {/* Model Badge with Complexity Router Tier */}
        <ModelBadge
          modelName={activeModel}
          tier={settings?.useComplexityRouting ? complexity.tier : undefined}
          tierName={complexity.tierName}
          tooltip={settings?.useComplexityRouting ? `Complexity Router: ${complexity.tierName} (${activeModel}) — ${complexity.reasoning}` : `Coding Model: ${activeModel}`}
        />
      </div>
    </div>
  )
}
