import React from 'react'
import { OllamaEnvConfig } from '../../services/hardwareRecommendationEngine'
import { ShieldCheck, X, RefreshCw, Check } from 'lucide-react'
import { useTranslation } from '../../i18n'

interface OllamaEnvApprovalModalProps {
  isOpen: boolean
  onClose: () => void
  envConfig: OllamaEnvConfig
  restartOllamaAfterApply: boolean
  onChangeRestartOllamaAfterApply: (value: boolean) => void
  isApplyingEnvVars: boolean
  onApply: () => void
}

export const OllamaEnvApprovalModal: React.FC<OllamaEnvApprovalModalProps> = ({
  isOpen,
  onClose,
  envConfig,
  restartOllamaAfterApply,
  onChangeRestartOllamaAfterApply,
  isApplyingEnvVars,
  onApply,
}) => {
  const { t } = useTranslation()

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col">
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-100 text-sm">{t('ollamaEnvParams.approvalTitle')}</h3>
              <p className="text-[11px] text-slate-400">{t('ollamaEnvParams.approvalSubtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors focus-ring cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto text-xs">
          <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-800/40 text-amber-200/90 leading-relaxed text-[11px]">
            {t('ollamaEnvParams.approvalIntro', { profile: envConfig.profileTier.toUpperCase() })}
          </div>

          <div className="space-y-2 font-mono">
            {envConfig.variables.map((v) => (
              <div key={v.name} className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-cyan-300 text-[11px]">{v.name}</span>
                  <span className="px-2 py-0.5 rounded bg-slate-900 text-amber-300 font-bold border border-slate-700 text-[10px]">
                    {v.value}
                  </span>
                </div>
                <p className="text-slate-400 font-sans text-[10px]">{v.description} — <span className="italic text-slate-400">{v.rationale}</span></p>
              </div>
            ))}
          </div>

          <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
            <input
              type="checkbox"
              checked={restartOllamaAfterApply}
              onChange={(e) => onChangeRestartOllamaAfterApply(e.target.checked)}
              className="rounded border-slate-700 text-cyan-500 focus:ring-cyan-500 h-4 w-4 bg-slate-900"
            />
            <span className="text-[11px] text-slate-300">
              {t('ollamaEnvParams.restartOllamaCheckbox')}
            </span>
          </label>
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-950/80 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isApplyingEnvVars}
            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-colors"
          >
            {t('ollamaEnvParams.cancel')}
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={isApplyingEnvVars}
            className="px-4 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-bold rounded-xl text-xs transition-all shadow-md flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
          >
            {isApplyingEnvVars ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>{t('ollamaEnvParams.applying')}</span>
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>{t('ollamaEnvParams.approveAndApply')}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
