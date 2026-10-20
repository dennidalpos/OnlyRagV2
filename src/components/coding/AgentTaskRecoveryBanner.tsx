import type { AgentTaskRecovery } from '../../types'
import { useTranslation } from '../../i18n'

export function AgentTaskRecoveryBanner({
  tasks,
  error,
  busy,
  onResume,
}: {
  tasks: AgentTaskRecovery[]
  error: string
  busy: boolean
  onResume: (task: AgentTaskRecovery) => Promise<void>
}) {
  const { t } = useTranslation()
  if (!tasks.length && !error) return null
  return (
    <div role="status" className="border-b border-amber-800 bg-amber-950/40 p-3 text-sm text-amber-100 max-h-48 overflow-auto">
      <p>{t('agentRecovery.notice')}</p>
      {error && (
        <p role="alert">
          {t('agentRecovery.failure')}: {error}
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
            disabled={busy}
            onClick={() => void onResume(task)}
            className="shrink-0 rounded border border-amber-600 px-3 py-1 disabled:opacity-50"
          >
            {t('agentRecovery.resume')}
          </button>
        </div>
      ))}
    </div>
  )
}
