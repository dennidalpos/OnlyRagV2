import React, { useEffect, useState } from 'react'
import { AppSettings, TaskQueueStatus } from '../../types'
import { Layers, ShieldCheck, Activity } from 'lucide-react'
import { useTranslation } from '../../i18n'

interface AgentExecutionLimitsConfigProps {
  settings: AppSettings
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void
}

const QUEUE_STATUS_POLL_MS = 3000

/**
 * Agent execution limits. Task concurrency is deliberately NOT configurable here:
 * the queue is fixed at one running task (see taskQueueAppService.ts), because the
 * tool executor owns a single workspace journal and shared persistent shells.
 */
export const AgentExecutionLimitsConfig: React.FC<AgentExecutionLimitsConfigProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const { t } = useTranslation()
  const [queueStatus, setQueueStatus] = useState<TaskQueueStatus | null>(null)

  useEffect(() => {
    if (!window.electronAPI?.getAgentQueueStatus) return
    let cancelled = false

    const poll = async () => {
      const status = await window.electronAPI!.getAgentQueueStatus()
      if (!cancelled) setQueueStatus(status)
    }

    poll()
    const interval = setInterval(poll, QUEUE_STATUS_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return (
    <div className="glass-panel rounded-xl p-5 border border-slate-800 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div>
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2.5">
            <Layers className="w-5 h-5 text-cyan-400" /> {t('settings.executionLimitsSection')}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">{t('settings.executionLimitsDesc')}</p>
        </div>

        {queueStatus && (
          <div
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl shrink-0"
            title={`${t('settings.queueLiveStatusRunning')}: ${queueStatus.runningCount} · ${t('settings.queueLiveStatusQueued')}: ${queueStatus.queuedCount}`}
          >
            <Activity className={`w-3.5 h-3.5 ${queueStatus.runningCount > 0 ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
            <span className="text-xs font-mono text-slate-200">
              {t('settings.queueLiveStatusRunning')}: <strong className="text-emerald-300">{queueStatus.runningCount}</strong>
              {' · '}
              {t('settings.queueLiveStatusQueued')}: <strong className="text-amber-300">{queueStatus.queuedCount}</strong>
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 p-2.5 bg-slate-900/60 border border-slate-800/80 rounded-xl text-xs text-slate-400">
        <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
        <span>
          <strong>{t('settings.queueProtectionTitle')}</strong> {t('settings.queueProtectionDesc')}
        </span>
      </div>

      {/* Max Tool Call Steps Slider / Selector */}
      <div className="pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <span className="text-xs font-bold text-slate-200">{t('settings.toolCallStepsTitle')}</span>
          <p className="text-[11px] text-slate-400 leading-relaxed">{t('settings.toolCallStepsDesc')}</p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto shrink-0">
          <input
            type="range"
            min={10}
            max={200}
            step={5}
            value={settings.maxToolCallSteps === 0 || (settings.maxToolCallSteps && settings.maxToolCallSteps >= 200) ? 200 : (settings.maxToolCallSteps || 50)}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              onUpdateSettings({ maxToolCallSteps: val >= 200 ? 0 : val })
            }}
            className="w-32 accent-cyan-400 bg-slate-900 cursor-pointer"
            aria-label={t('settings.toolCallStepsTitle')}
          />
          <span className="text-xs font-mono font-bold text-cyan-300 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 min-w-[70px] text-center shadow-inner">
            {settings.maxToolCallSteps === 0 || (settings.maxToolCallSteps && settings.maxToolCallSteps >= 200)
              ? t('settings.toolCallStepsUnlimited')
              : t('settings.toolCallStepsValue', { steps: settings.maxToolCallSteps || 50 })}
          </span>
        </div>
      </div>
    </div>
  )
}
