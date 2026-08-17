import React from 'react'
import { AlertTriangle, Check, X } from 'lucide-react'
import { useTranslation } from '../../i18n'

interface PendingApprovalModalProps {
  pendingApproval: {
    type: 'write_file' | 'replace_chunk' | 'multi_replace' | 'delete_file' | 'download_file' | 'terminal_cmd'
    target: string
    contentOrCmd: string
    replacement?: string
    replacements?: { targetContent: string; replacementContent: string }[]
    parameters?: Record<string, any>
  } | null
  onApprove: () => void
  onReject: () => void
}

export const PendingApprovalModal: React.FC<PendingApprovalModalProps> = ({
  pendingApproval,
  onApprove,
  onReject,
}) => {
  const { t } = useTranslation()

  // ESC Key Listener for Accessibility
  React.useEffect(() => {
    if (!pendingApproval) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onReject()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pendingApproval, onReject])

  if (!pendingApproval) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-modal-title"
      className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <div className="bg-slate-900 border border-amber-500/50 rounded-2xl p-6 max-w-xl w-full shadow-2xl space-y-4">
        <div className="flex items-center gap-3 text-amber-400">
          <AlertTriangle className="w-6 h-6 shrink-0" />
          <h3 id="approval-modal-title" className="font-bold text-lg text-slate-100">
            {t('coding.pendingApprovalTitle')}
          </h3>
        </div>

        <p className="text-xs text-slate-300">
          {t('coding.pendingApprovalDesc')}
        </p>

        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs font-mono space-y-2">
          <div className="text-slate-300">
            {t('common.actions')}: <span className="text-amber-300 font-bold uppercase">{pendingApproval.type}</span>
          </div>
          <div className="text-slate-300">
            Target: <span className="text-slate-200 font-bold">{pendingApproval.target}</span>
          </div>

          <div className="mt-2 text-slate-300 max-h-48 overflow-y-auto whitespace-pre-wrap bg-slate-900 p-2.5 rounded border border-slate-800">
            {pendingApproval.type === 'download_file' ? (
              <div>
                <div className="text-sky-400 text-[10px] uppercase font-bold">Source URL:</div>
                <div className="text-slate-200 mb-2 break-all">{pendingApproval.contentOrCmd}</div>
                <div className="text-amber-400 text-[10px] uppercase font-bold">Destination:</div>
                <div className="text-emerald-300">{pendingApproval.target}</div>
              </div>
            ) : pendingApproval.type === 'delete_file' ? (
              <div className="text-rose-400 font-semibold">
                {t('ingestion.deleteConfirm')} {pendingApproval.target}
              </div>
            ) : pendingApproval.type === 'multi_replace' && pendingApproval.replacements ? (
              <div className="space-y-3">
                <div className="text-cyan-400 text-[10px] uppercase font-bold">
                  {pendingApproval.replacements.length} Replacement Chunk(s):
                </div>
                {pendingApproval.replacements.map((chunk, idx) => (
                  <div key={idx} className="p-2 bg-slate-950 rounded border border-slate-800 space-y-1">
                    <div className="text-red-400 text-[10px] uppercase font-bold">Target [{idx + 1}]:</div>
                    <div className="text-slate-300">{chunk.targetContent}</div>
                    <div className="text-emerald-400 text-[10px] uppercase font-bold">Replacement:</div>
                    <div className="text-emerald-300">{chunk.replacementContent}</div>
                  </div>
                ))}
              </div>
            ) : pendingApproval.replacement ? (
              <div>
                <div className="text-red-400 text-[10px] uppercase font-bold">Search Target:</div>
                <div className="text-slate-300 mb-2">{pendingApproval.contentOrCmd}</div>
                <div className="text-emerald-400 text-[10px] uppercase font-bold">Replacement:</div>
                <div className="text-emerald-300">{pendingApproval.replacement}</div>
              </div>
            ) : (
              pendingApproval.contentOrCmd
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onReject}
            aria-label={t('coding.rejectBtn')}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-all focus-ring active:scale-95 flex items-center gap-1.5"
          >
            <X className="w-4 h-4 text-slate-400" /> {t('coding.rejectBtn')}
          </button>
          <button
            type="button"
            onClick={onApprove}
            aria-label={t('coding.approveBtn')}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-xl transition-all focus-ring active:scale-95 flex items-center gap-1.5 shadow-md shadow-emerald-950/50"
          >
            <Check className="w-4 h-4" /> {t('coding.approveBtn')}
          </button>
        </div>
      </div>
    </div>
  )
}
