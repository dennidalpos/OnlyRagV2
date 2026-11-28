import { useState } from 'react'
import type { AgentTaskInspection, AgentTaskRecovery } from '../../types'
import { useTranslation } from '../../i18n'
import { errorMessage } from '../../../shared/domain/errors/errorMessage'

export function AgentTaskRecoveryBanner({
  tasks,
  error,
  busy,
  onResume,
  onInspect,
  onAbandon,
}: {
  tasks: AgentTaskRecovery[]
  error: string
  busy: boolean
  onResume: (task: AgentTaskRecovery) => Promise<void>
  onInspect: (task: AgentTaskRecovery) => Promise<AgentTaskInspection>
  onAbandon: (task: AgentTaskRecovery, evidenceDigest: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [inspection, setInspection] = useState<AgentTaskInspection | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [pending, setPending] = useState(false)
  const [localError, setLocalError] = useState('')
  const inspectedTask = tasks.find((task) => task.identity.runId === inspection?.identity.runId)
  const actOnEvidence = async (action: () => Promise<void>) => {
    setPending(true)
    setLocalError('')
    try {
      await action()
    } catch (error: unknown) {
      setLocalError(errorMessage(error))
    } finally {
      setPending(false)
    }
  }
  if (!tasks.length && !error) return null
  return (
    <div role="status" className="border-b border-amber-800 bg-amber-950/40 p-3 text-sm text-amber-100 max-h-48 overflow-auto">
      <p>{t('agentRecovery.notice')}</p>
      {(error || localError) && (
        <p role="alert">
          {t('agentRecovery.failure')}: {localError || error}
        </p>
      )}
      {tasks.map((task) => (
        <div key={task.identity.runId} className="flex items-center gap-3 mt-2">
          <span className="min-w-0 flex-1 truncate" title={task.userTask}>
            {task.userTask}
          </span>
          <span>{task.agentMode}</span>
          <span className="text-xs">
            {task.activeModel || '—'} · {t('agentRecovery.files')}: {String(task.capabilityProfile.allowFileModifications)} · {t('agentRecovery.terminal')}:{' '}
            {String(task.capabilityProfile.allowTerminalExecution)} · {task.capabilityProfile.capabilityPolicyMode}
            {task.capabilityProfile.fullAccess ? ` · ${t('agentRecovery.fullAccess')}` : ''}
          </span>
          <button
            type="button"
            disabled={busy || pending}
            onClick={() => void onResume(task)}
            className="shrink-0 rounded border border-amber-600 px-3 py-1 disabled:opacity-50"
          >
            {t('agentRecovery.resume')}
          </button>
          <button
            type="button"
            disabled={busy || pending}
            className="shrink-0 rounded border border-amber-600 px-3 py-1 disabled:opacity-50"
            onClick={() =>
              void actOnEvidence(async () => {
                setInspection(null)
                setConfirmed(false)
                setInspection(await onInspect(task))
              })
            }
          >
            {t('agentRecovery.inspect')}
          </button>
        </div>
      ))}
      {inspection && inspectedTask && (
        <section aria-label={t('agentRecovery.inspect')} className="mt-3">
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs" tabIndex={0}>
            {inspection.evidence}
          </pre>
          {inspection.canAbandon && (
            <>
              <label className="block my-2">
                <input type="checkbox" checked={confirmed} disabled={busy || pending} onChange={(event) => setConfirmed(event.target.checked)} />{' '}
                {t('agentRecovery.abandonConsent')}
              </label>
              <button
                type="button"
                disabled={busy || pending || !confirmed}
                className="rounded border border-amber-600 px-3 py-1 disabled:opacity-50"
                onClick={() =>
                  void actOnEvidence(async () => {
                    await onAbandon(inspectedTask, inspection.evidenceDigest)
                    setInspection(null)
                    setConfirmed(false)
                  })
                }
              >
                {t('agentRecovery.abandon')}
              </button>
            </>
          )}
        </section>
      )}
    </div>
  )
}
