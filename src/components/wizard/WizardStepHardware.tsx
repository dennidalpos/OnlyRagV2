import React from 'react'
import { Sparkles, Zap, Download, Cpu } from 'lucide-react'
import { DiagnosticsData } from '../../types'
import { HardwareRecommendations } from '../../services/hardwareRecommendationEngine'
import { useTranslation } from '../../i18n'

export interface WizardStepHardwareProps {
  diagnostics: DiagnosticsData | null
  recommendations: HardwareRecommendations
  downloadedModels: string[]
  isInstallingOllama: boolean
  isInitialSetup?: boolean
  onLaunchOrInstallOllama: () => void
  onAutoApply: () => void
}

export const WizardStepHardware: React.FC<WizardStepHardwareProps> = ({
  diagnostics,
  recommendations,
  downloadedModels,
  isInstallingOllama,
  isInitialSetup,
  onLaunchOrInstallOllama,
  onAutoApply,
}) => {
  const { t } = useTranslation()

  return (
    <div className="space-y-4">
      {isInitialSetup && (
        <div className="p-3.5 rounded-xl bg-cyan-950/40 border border-cyan-500/40 space-y-1 shadow-md">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold text-cyan-200 uppercase tracking-wider">
              {t('hardwareWizard.initialWelcomeBadge')}
            </h3>
          </div>
          <p className="text-xs text-slate-300">
            {t('hardwareWizard.modalSubtitle')}
          </p>
        </div>
      )}

      {/* Hardware Profile Scan */}
      <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
        <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2 uppercase tracking-wider">
          <Cpu className="w-4 h-4 text-cyan-400" /> {t('hardwareWizard.detectedProfile')}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
            <span className="text-slate-400 block text-[10px]">{t('hardwareWizard.detectedProfile')}:</span>
            <span className="font-semibold text-cyan-300">{recommendations.profileName}</span>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
            <span className="text-slate-400 block text-[10px]">Safe Net VRAM Budget (Anti-Choke):</span>
            <span className="font-semibold text-emerald-300 font-mono">
              {recommendations.safeVramBudgetGB > 0
                ? `${recommendations.safeVramBudgetGB.toFixed(1)} GB Net (Buffer 25% + 1.5GB OS)`
                : 'CPU / RAM Bound'}
            </span>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
            <span className="text-slate-400 block text-[10px]">{t('diagnostics.gpuTitle')}:</span>
            <span className="font-semibold text-slate-200 font-mono">{recommendations.gpuSummary}</span>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
            <span className="text-slate-400 block text-[10px]">{t('diagnostics.ramTitle')}:</span>
            <span className="font-semibold text-slate-200 font-mono">{recommendations.ramSummary}</span>
          </div>
        </div>
      </div>

      {/* Ollama Status & Launch Card */}
      <div
        className={`p-3.5 rounded-xl border flex items-center justify-between transition-all ${
          diagnostics?.ollama.status === 'online'
            ? 'bg-emerald-950/30 border-emerald-500/50'
            : 'bg-rose-950/30 border-rose-500/50'
        }`}
      >
        <div className="flex items-center gap-3">
          <Zap
            className={`w-5 h-5 ${
              diagnostics?.ollama.status === 'online' ? 'text-emerald-400' : 'text-rose-400'
            }`}
          />
          <div>
            <div className="font-bold text-xs text-slate-100 flex items-center gap-2">
              <span>{t('hardwareWizard.ollamaStatus')}:</span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold capitalize ${
                  diagnostics?.ollama.status === 'online'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    : 'bg-rose-950 text-rose-300 border border-rose-800'
                }`}
              >
                {diagnostics?.ollama.status || t('common.offline')}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {diagnostics?.ollama.status === 'online'
                ? `${downloadedModels.length} ${t('settings.installedLocalModels')}`
                : t('sidebar.installLaunchOllama')}
            </p>
          </div>
        </div>

        {diagnostics?.ollama.status !== 'online' && (
          <button
            type="button"
            onClick={onLaunchOrInstallOllama}
            disabled={isInstallingOllama}
            className="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold text-xs rounded-xl transition-all flex items-center gap-1.5 shrink-0 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" />{' '}
            {isInstallingOllama ? t('common.loading') : t('sidebar.installLaunchOllama')}
          </button>
        )}
      </div>

      {/* Quick 1-Click Auto-Apply Recommended Setup */}
      <div className="p-3.5 rounded-xl bg-cyan-950/20 border border-cyan-500/30 flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <span className="font-bold text-xs text-cyan-300 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> {t('hardwareWizard.autoApplyRecommended')}
          </span>
          <p className="text-[11px] text-slate-400">
            {t('hardwareWizard.step1Subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={onAutoApply}
          className="px-3.5 py-1.5 bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 text-slate-950 font-bold text-xs rounded-xl transition-all focus-ring shrink-0 shadow-md shadow-cyan-950/40 active:scale-95"
        >
          {t('hardwareWizard.autoApplyRecommended')} (1-Click)
        </button>
      </div>
    </div>
  )
}
