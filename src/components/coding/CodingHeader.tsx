import React from 'react'
import { Code, ChevronRight, Cpu, Sparkles } from 'lucide-react'
import { AppSettings } from '../../types'
import { evaluateTaskComplexity } from '../../services/complexityRouterService'
import { ModelBadge } from '../common/ModelBadge'
import { useTranslation } from '../../i18n'

interface CodingHeaderProps {
  guestOsInfo: any
  settings?: AppSettings
  agentPrompt: string
  pinnedFilesCount: number
  editorContentLength: number
  activeSkills?: string[]
  availableModels?: string[]
}

export const CodingHeader: React.FC<CodingHeaderProps> = ({
  guestOsInfo,
  settings,
  agentPrompt,
  pinnedFilesCount,
  editorContentLength,
  activeSkills = [],
  availableModels,
}) => {
  const { t } = useTranslation()
  const complexity = evaluateTaskComplexity(agentPrompt, {
    attachedFilesCount: pinnedFilesCount,
    contextSizeChars: editorContentLength,
    settings,
    availableModels,
  })
  const activeModel = settings?.useComplexityRouting
    ? complexity.modelName
    : (settings?.codingModel || settings?.defaultModel || 'qwen2.5-coder:7b')

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

        {/* Hardware Status Pill */}
        <div className="hidden xl:flex items-center gap-2 text-[10px] text-slate-400 font-mono bg-slate-900/60 px-2.5 py-1 rounded-xl border border-slate-800">
          <Cpu className="w-3 h-3 text-cyan-400" />
          <span>
            {guestOsInfo
              ? `${guestOsInfo.platform || 'win32'} • ${guestOsInfo.cpuCount ?? guestOsInfo.cpus ?? 'N/A'} Cores • ${guestOsInfo.freeMemoryGB ?? (guestOsInfo.freeMemMb ? (guestOsInfo.freeMemMb / 1024).toFixed(1) : '0')}/${guestOsInfo.totalMemoryGB ?? (guestOsInfo.totalMemMb ? (guestOsInfo.totalMemMb / 1024).toFixed(1) : '0')} GB`
              : t('coding.osDetecting')}
          </span>
          {(guestOsInfo?.tools || guestOsInfo?.hasGit !== undefined) && (
            <span className="flex items-center gap-1 border-l border-slate-800 pl-1.5 ml-1">
              <span className={`px-1 rounded text-[8px] font-bold ${(guestOsInfo.tools?.git ?? guestOsInfo.hasGit) ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>GIT</span>
              <span className={`px-1 rounded text-[8px] font-bold ${(guestOsInfo.tools?.node ?? guestOsInfo.hasNode) ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>NODE</span>
              <span className={`px-1 rounded text-[8px] font-bold ${(guestOsInfo.tools?.python ?? guestOsInfo.hasPython) ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>PY</span>
              <span className={`px-1 rounded text-[8px] font-bold ${(guestOsInfo.tools?.ollama ?? guestOsInfo.hasOllama) ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>OLLAMA</span>
            </span>
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
    </div>
  )
}
