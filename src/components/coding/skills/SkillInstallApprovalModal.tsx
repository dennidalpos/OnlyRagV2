import React, { useEffect } from 'react'
import { Check, Package, Store, Target, X } from 'lucide-react'
import { SkillInstallApprovalRequest } from '../../../types'
import { useTranslation } from '../../../i18n'

interface SkillInstallApprovalModalProps {
  request: SkillInstallApprovalRequest | null
  onApprove: (requestId: string) => void
  onReject: (requestId: string) => void
}

/**
 * Confirmation required by the `autoInstallHubSkills: 'prompt'` policy before the Skill
 * Router installs a skill discovered on a hub. Closing the modal denies the install.
 */
export const SkillInstallApprovalModal: React.FC<SkillInstallApprovalModalProps> = ({ request, onApprove, onReject }) => {
  const { t } = useTranslation()

  useEffect(() => {
    if (!request) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onReject(request.requestId)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [request, onReject])

  if (!request) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-indigo-500/50 bg-[#0f172a] shadow-2xl text-slate-200 font-sans">
        <div className="flex items-center gap-2 p-4 border-b border-slate-800">
          <Package className="w-4 h-4 text-indigo-400" />
          <h2 className="text-sm font-bold text-indigo-300">{t('coding.skillInstallTitle')}</h2>
        </div>

        <div className="p-4 space-y-3 text-xs">
          <p className="text-slate-300">{t('coding.skillInstallQuestion')}</p>

          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2">
            <div className="flex items-center gap-2 font-bold text-slate-100">
              <Package className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="truncate">{request.skillName}</span>
            </div>
            {request.skillDescription && <p className="text-[11px] text-slate-400 leading-relaxed">{request.skillDescription}</p>}
            <div className="flex items-center gap-4 font-mono text-[10px] text-slate-400">
              <span className="flex items-center gap-1.5">
                <Store className="w-3 h-3 text-slate-500" /> {request.hubName}
              </span>
              <span className="flex items-center gap-1.5">
                <Target className="w-3 h-3 text-slate-500" /> {t('coding.skillInstallScore', { score: request.score.toFixed(1) })}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-800">
          <button
            type="button"
            onClick={() => onReject(request.requestId)}
            className="px-3 py-1.5 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs font-bold flex items-center gap-1.5"
          >
            <X className="w-3.5 h-3.5" /> {t('coding.skillInstallReject')}
          </button>
          <button
            type="button"
            onClick={() => onApprove(request.requestId)}
            className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" /> {t('coding.skillInstallApprove')}
          </button>
        </div>
      </div>
    </div>
  )
}
