import React from 'react'
import { Zap, Sliders } from 'lucide-react'
import { DiagnosticsData } from '../../types'
import { useTranslation } from '../../i18n'
import { useOllamaEnvParams } from '../../hooks/useOllamaEnvParams'
import { OllamaEnvParamsModal } from '../diagnostics/OllamaEnvParamsModal'
import { OllamaEnvApprovalModal } from '../diagnostics/OllamaEnvApprovalModal'

interface OllamaEnvParamsCardProps {
  diagnostics: DiagnosticsData | null
  onRefreshDiagnostics: () => void
}

/**
 * Settings-page entry point for the "Ollama Client OS Parameters" feature, which
 * previously only lived inside the Diagnostics Drawer (disconnected from the
 * Hardware/Model configuration surface it actually belongs to). Shares state and
 * the apply-to-OS flow with the drawer via useOllamaEnvParams, so both surfaces
 * stay in sync without duplicating the approval-modal logic.
 */
export const OllamaEnvParamsCard: React.FC<OllamaEnvParamsCardProps> = ({
  diagnostics,
  onRefreshDiagnostics,
}) => {
  const { t } = useTranslation()
  const {
    envConfig,
    showEnvParamsModal,
    setShowEnvParamsModal,
    showApprovalModal,
    setShowApprovalModal,
    isApplyingEnvVars,
    restartOllamaAfterApply,
    setRestartOllamaAfterApply,
    applyEnvFeedback,
    handleApplyEnvVars,
  } = useOllamaEnvParams(diagnostics, onRefreshDiagnostics)

  return (
    <div className="glass-panel rounded-xl p-5 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
          <Zap className="w-4.5 h-4.5 text-amber-400" />
        </div>
        <div className="space-y-0.5">
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            {t('ollamaEnvParams.settingsCardTitle')}
            <span className="px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 text-[10px] font-mono border border-amber-800/60 font-bold uppercase">
              {envConfig.profileTier}
            </span>
          </h2>
          <p className="text-xs text-slate-400 max-w-xl">{t('ollamaEnvParams.settingsCardDesc')}</p>
          {applyEnvFeedback && (
            <p className={`text-[11px] font-mono ${applyEnvFeedback.success ? 'text-emerald-400' : 'text-rose-400'}`}>
              {applyEnvFeedback.message}
            </p>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowEnvParamsModal(true)}
        aria-label={t('ollamaEnvParams.viewBtnAria')}
        className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-amber-500/50 text-slate-200 text-xs font-semibold rounded-xl transition-all focus-ring flex items-center gap-2 shrink-0 active:scale-95 shadow-sm"
      >
        <Sliders className="w-4 h-4 text-amber-400" /> {t('ollamaEnvParams.viewBtn')}
      </button>

      <OllamaEnvParamsModal
        isOpen={showEnvParamsModal}
        onClose={() => setShowEnvParamsModal(false)}
        envConfig={envConfig}
        onOpenApprovalModal={() => setShowApprovalModal(true)}
      />
      <OllamaEnvApprovalModal
        isOpen={showApprovalModal}
        onClose={() => setShowApprovalModal(false)}
        envConfig={envConfig}
        restartOllamaAfterApply={restartOllamaAfterApply}
        onChangeRestartOllamaAfterApply={setRestartOllamaAfterApply}
        isApplyingEnvVars={isApplyingEnvVars}
        onApply={handleApplyEnvVars}
      />
    </div>
  )
}
