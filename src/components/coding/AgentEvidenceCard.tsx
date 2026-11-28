import React from 'react'
import { AlertTriangle, CheckCircle2, FileCode2, RotateCcw, ShieldCheck, XCircle } from 'lucide-react'
import type { ExecutedPrompt, WorkspaceFile } from '../../types'
import { useTranslation } from '../../i18n'

interface AgentEvidenceCardProps {
  prompt: ExecutedPrompt
  /** Workspace the run edited; required to restore its checkpoint. */
  workspacePath?: string | null
  onOpenFile?: (file: WorkspaceFile) => void
  onOpenRightTab?: (tab: 'editor' | 'terminal' | 'git_diff' | 'plan') => void
}

export const AgentEvidenceCard: React.FC<AgentEvidenceCardProps> = ({ prompt, workspacePath, onOpenFile, onOpenRightTab }) => {
  const { t } = useTranslation()
  const evidence = prompt.evidence
  const [restoreState, setRestoreState] = React.useState<{ status: 'idle' | 'confirm' | 'running' | 'done' | 'failed'; message?: string }>({ status: 'idle' })
  const checkpointId = evidence?.checkpointId
  const restoreCheckpoint = async () => {
    if (!workspacePath || !checkpointId) return
    setRestoreState({ status: 'running' })
    try {
      const api = window.electronAPI
      if (!api) throw new Error(t('coding.checkpointRestoreFailed'))
      const result = await api.restoreAgentCheckpoint({ workspacePath, checkpointId })
      setRestoreState(
        result.success
          ? { status: 'done', message: t('coding.checkpointRestored', { count: result.restoredCount }) }
          : { status: 'failed', message: result.errors.join('\n') || t('coding.checkpointRestoreFailed') },
      )
    } catch (error: unknown) {
      setRestoreState({ status: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }
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
        : evidence?.cancellationStatus === 'kept'
          ? t('coding.evidenceKept')
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
          {checkpointId && workspacePath && (
            <div className="mt-2 space-y-1">
              {restoreState.status === 'idle' && (
                <button
                  type="button"
                  onClick={() => setRestoreState({ status: 'confirm' })}
                  className="rounded-md border border-sky-700 px-2 py-1 text-[11px] font-semibold text-sky-200 hover:bg-sky-900/40"
                >
                  {t('coding.checkpointRestore')}
                </button>
              )}
              {restoreState.status === 'confirm' && (
                <div className="space-y-1">
                  <div className="text-[11px] text-amber-200">{t('coding.checkpointRestoreConfirm')}</div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => void restoreCheckpoint()}
                      className="rounded-md bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-sky-500"
                    >
                      {t('coding.checkpointRestore')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRestoreState({ status: 'idle' })}
                      className="rounded-md border border-slate-600 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              )}
              {restoreState.status === 'running' && <div className="text-[11px] text-slate-400">{t('coding.checkpointRestoring')}</div>}
              {(restoreState.status === 'done' || restoreState.status === 'failed') && (
                <div
                  role="status"
                  className={restoreState.status === 'done' ? 'text-[11px] text-emerald-300' : 'whitespace-pre-wrap text-[11px] text-rose-300'}
                >
                  {restoreState.message}
                </div>
              )}
            </div>
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
