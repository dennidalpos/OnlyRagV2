import React, { useEffect, useState } from 'react'
import { AppSettings, DiagnosticsData, TaskQueueStatus } from '../../types'
import { Cpu, Layers, ShieldCheck, Activity, AlertTriangle } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { getRecommendedOllamaEnvVars } from '../../services/hardwareRecommendationEngine'

interface TaskConcurrencyConfigProps {
  settings: AppSettings
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void
  diagnostics?: DiagnosticsData | null
}

const QUEUE_STATUS_POLL_MS = 3000

export const TaskConcurrencyConfig: React.FC<TaskConcurrencyConfigProps> = ({
  settings,
  onUpdateSettings,
  diagnostics = null,
}) => {
  const { t } = useTranslation()
  const currentConcurrency = settings.maxConcurrentTasks || 1
  const [queueStatus, setQueueStatus] = useState<TaskQueueStatus | null>(null)

  const recommendedParallel = parseInt(
    getRecommendedOllamaEnvVars(diagnostics, t).variables.find((v) => v.name === 'OLLAMA_NUM_PARALLEL')?.value || '1',
    10
  )
  const exceedsRecommendedParallel = currentConcurrency > recommendedParallel

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

  const handleSelectConcurrency = (val: number) => {
    onUpdateSettings({ maxConcurrentTasks: val })
    if (window.electronAPI?.setAgentMaxConcurrency) {
      window.electronAPI.setAgentMaxConcurrency(val)
    }
  }

  const presets = [
    { value: 1, label: '1 (Sequential)', desc: t('settings.concurrencyPreset1Desc'), tag: 'Recommended' },
    { value: 2, label: '2 (Balanced)', desc: t('settings.concurrencyPreset2Desc'), tag: 'Fast' },
    { value: 4, label: '4 (Multi-Task)', desc: t('settings.concurrencyPreset4Desc'), tag: 'Advanced' },
    { value: 8, label: '8 (Maximum)', desc: t('settings.concurrencyPreset8Desc'), tag: 'Extreme' },
  ]

  return (
    <div className="glass-panel rounded-xl p-5 border border-slate-800 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div>
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2.5">
            <Layers className="w-5 h-5 text-cyan-400" /> {t('settings.concurrencySection')}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {t('settings.concurrencyDesc')}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl">
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs font-mono text-slate-200">
              {t('settings.concurrencyMaxTasksLabel', { count: currentConcurrency })}
            </span>
          </div>
          {queueStatus && (
            <div
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl"
              title={`${t('settings.concurrencyLiveStatusRunning')}: ${queueStatus.runningCount} · ${t('settings.concurrencyLiveStatusQueued')}: ${queueStatus.queuedCount}`}
            >
              <Activity className={`w-3.5 h-3.5 ${queueStatus.runningCount > 0 ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
              <span className="text-xs font-mono text-slate-200">
                {t('settings.concurrencyLiveStatusRunning')}: <strong className="text-emerald-300">{queueStatus.runningCount}</strong>
                {' · '}
                {t('settings.concurrencyLiveStatusQueued')}: <strong className="text-amber-300">{queueStatus.queuedCount}</strong>
              </span>
            </div>
          )}
        </div>
      </div>

      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
        role="radiogroup"
        aria-label="Task concurrency preset selection"
      >
        {presets.map((preset) => {
          const isSelected = currentConcurrency === preset.value
          return (
            <button
              key={preset.value}
              type="button"
              role="radio"
              tabIndex={isSelected ? 0 : -1}
              aria-checked={isSelected}
              onClick={() => handleSelectConcurrency(preset.value)}
              aria-label={`Set concurrency to ${preset.value} tasks`}
              className={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between space-y-2 cursor-pointer focus-ring active:scale-[0.98] ${
                isSelected
                  ? 'bg-cyan-950/40 border-cyan-500 shadow-md shadow-cyan-950/40 ring-1 ring-cyan-500/50'
                  : 'bg-slate-900/80 hover:bg-slate-800/80 border-slate-800 hover:border-slate-700 text-slate-300'
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className={`text-xs font-bold ${isSelected ? 'text-cyan-300' : 'text-slate-200'}`}>
                  {preset.label}
                </span>
                <span
                  className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-semibold uppercase ${
                    isSelected
                      ? 'bg-cyan-900 text-cyan-200 border border-cyan-700'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  {preset.tag}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">{preset.desc}</p>
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-2 p-2.5 bg-slate-900/60 border border-slate-800/80 rounded-xl text-xs text-slate-400">
        <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
        <span>
          <strong>{t('settings.concurrencyQueueProtectionTitle')}</strong> {t('settings.concurrencyQueueProtectionDesc')}
        </span>
      </div>

      {exceedsRecommendedParallel && (
        <div className="flex items-center gap-2 p-2.5 bg-amber-950/30 border border-amber-800/40 rounded-xl text-xs text-amber-200/90">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            {t('settings.concurrencyExceedsParallelWarning', { count: currentConcurrency, parallel: recommendedParallel })}
          </span>
        </div>
      )}

      {/* Max Tool Call Steps Slider / Selector */}
      <div className="pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <span className="text-xs font-bold text-slate-200">
            {t('settings.toolCallStepsTitle')}
          </span>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {t('settings.toolCallStepsDesc')}
          </p>
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
