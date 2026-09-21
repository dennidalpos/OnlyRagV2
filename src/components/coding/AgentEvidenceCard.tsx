import React from 'react'
import { AlertTriangle, CheckCircle2, FileCode2, RotateCcw, ShieldCheck, XCircle } from 'lucide-react'
import type { ExecutedPrompt, WorkspaceFile } from '../../types'
import { useTranslation } from '../../i18n'

interface AgentEvidenceCardProps {
  prompt: ExecutedPrompt
  onOpenFile?: (file: WorkspaceFile) => void
  onOpenRightTab?: (tab: 'editor' | 'terminal' | 'git_diff' | 'plan') => void
}

export const AgentEvidenceCard: React.FC<AgentEvidenceCardProps> = ({ prompt, onOpenFile, onOpenRightTab }) => {
  const { t } = useTranslation()
  const evidence = prompt.evidence
  const changedFiles = evidence?.changedFiles || []
  const verification = evidence?.verification
  const verificationLabel =
    verification?.status === 'verified'
      ? t('coding.evidenceVerified')
      : verification?.status === 'failed'
        ? t('coding.evidenceFailed')
        : t('coding.evidenceUnavailable')
  const cancellationLabel =
    evidence?.cancellationStatus === 'rolled_back'
      ? t('coding.evidenceRolledBack')
      : evidence?.cancellationStatus === 'residual_effects'
        ? t('coding.evidenceResiduals')
        : t('coding.evidenceNotCancelled')
  const isSuccessful = prompt.completionStatus === 'verified' || prompt.outcome === 'success'

  return (
    <section
      aria-label={t('coding.evidenceTitle')}
      className="mt-2 rounded-2xl border border-slate-700 bg-slate-900/90 p-3.5 font-sans text-xs text-slate-200 shadow-lg"
    >
      <div className="mb-3 flex items-center gap-2 border-b border-slate-700 pb-2">
        {isSuccessful ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-amber-400" />}
        <h3 className="font-bold text-slate-100">{t('coding.evidenceTitle')}</h3>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-300">
            <FileCode2 className="h-3.5 w-3.5 text-cyan-400" />
            {t('coding.evidenceFiles')}
          </div>
          {changedFiles.length > 0 ? (
            <ul className="space-y-1">
              {changedFiles.map((filePath) => (
                <li key={filePath}>
                  <button
                    type="button"
                    className="max-w-full truncate font-mono text-[11px] text-cyan-300 hover:text-cyan-200"
                    title={filePath}
                    onClick={() => {
                      onOpenFile?.({ name: filePath.split(/[\\/]/).pop() || filePath, path: filePath, isDir: false })
                      onOpenRightTab?.('editor')
                    }}
                  >
                    {filePath}
                  </button>
                </li>
              ))}
            </ul>
          ) : prompt.filesTouched > 0 ? (
            <span className="text-slate-400">{t('coding.evidenceLegacyFiles', { count: prompt.filesTouched })}</span>
          ) : (
            <span className="text-slate-400">{t('coding.evidenceNone')}</span>
          )}
        </div>

        <div>
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-300">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            {t('coding.evidenceVerification')}
          </div>
          <div className="text-slate-300">{verificationLabel}</div>
          {verification?.command && <code className="mt-1 block break-all text-[11px] text-slate-400">{verification.command}</code>}
          {verification?.detail && <div className="mt-1 whitespace-pre-wrap text-[11px] text-slate-400">{verification.detail}</div>}
        </div>

        <div>
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-300">
            <RotateCcw className="h-3.5 w-3.5 text-sky-400" />
            {t('coding.evidenceCancellation')}
          </div>
          <div className="text-slate-300">{cancellationLabel}</div>
          {evidence?.rollbackRestoredFiles !== undefined && (
            <div className="mt-1 text-[11px] text-slate-400">{t('coding.evidenceRollbackCount', { count: evidence.rollbackRestoredFiles })}</div>
          )}
        </div>

        <div>
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-300">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
            {t('coding.evidenceNonRollback')}
          </div>
          {evidence?.nonRollbackEffects.length ? (
            <ul className="space-y-1 text-[11px] text-amber-200">
              {evidence.nonRollbackEffects.map((effect) => (
                <li key={effect}>{effect}</li>
              ))}
            </ul>
          ) : (
            <span className="text-slate-400">{t('coding.evidenceNone')}</span>
          )}
        </div>
      </div>
    </section>
  )
}
