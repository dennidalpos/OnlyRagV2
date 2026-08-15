import React from 'react'
import { AppSettings } from '../../types'
import { Cpu, Layers, ShieldCheck } from 'lucide-react'
import { useTranslation } from '../../i18n'

interface TaskConcurrencyConfigProps {
  settings: AppSettings
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void
}

export const TaskConcurrencyConfig: React.FC<TaskConcurrencyConfigProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const { t } = useTranslation()
  const currentConcurrency = settings.maxConcurrentTasks || 1

  const handleSelectConcurrency = (val: number) => {
    onUpdateSettings({ maxConcurrentTasks: val })
    if (window.electronAPI?.setAgentMaxConcurrency) {
      window.electronAPI.setAgentMaxConcurrency(val)
    }
  }

  const presets = [
    { value: 1, label: '1 (Sequential)', desc: '1 task at a time. Zero VRAM/GPU conflicts.', tag: 'Recommended' },
    { value: 2, label: '2 (Balanced)', desc: '2 simultaneous tasks. Ideal for 8-12GB VRAM.', tag: 'Fast' },
    { value: 4, label: '4 (Multi-Task)', desc: '4 concurrent tasks for 16GB+ VRAM or powerful CPU.', tag: 'Advanced' },
    { value: 8, label: '8 (Maximum)', desc: '8 parallel tasks. Maximum throughput.', tag: 'Extreme' },
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

        <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl">
          <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-xs font-mono text-slate-200">
            Max: <strong className="text-cyan-300">{currentConcurrency}</strong> {currentConcurrency === 1 ? 'task' : 'tasks'}
          </span>
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
          <strong>Task Queue Protection:</strong> Excess requests queue cleanly and execute in serial order.
        </span>
      </div>

      {/* Max Tool Call Steps Slider / Selector */}
      <div className="pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <span className="text-xs font-bold text-slate-200">
            Limite Passaggi Tool Call (Agent Loops)
          </span>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Numero massimo di passaggi consecutivi di tool (lettura, refactoring, comandi) consentiti all'agente prima di richiedere conferma.
          </p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto shrink-0">
          <input
            type="range"
            min={10}
            max={200}
            step={5}
            value={settings.maxToolCallSteps || 50}
            onChange={(e) => onUpdateSettings({ maxToolCallSteps: parseInt(e.target.value, 10) })}
            className="w-32 accent-cyan-400 bg-slate-900 cursor-pointer"
            aria-label="Limite massimo passaggi tool call"
          />
          <span className="text-xs font-mono font-bold text-cyan-300 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 min-w-[54px] text-center shadow-inner">
            {settings.maxToolCallSteps || 50} step
          </span>
        </div>
      </div>
    </div>
  )
}
