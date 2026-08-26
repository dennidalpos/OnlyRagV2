import React from 'react'
import type { OllamaModelMetrics, AppSettings } from '../../types'

interface ModelContextControlProps {
  model: string
  settings: AppSettings
  metrics?: OllamaModelMetrics
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void
}

export const ModelContextControl: React.FC<ModelContextControlProps> = ({ model, settings, metrics, onUpdateSettings }) => {
  if (!model) return null
  const maximum = Math.max(4096, metrics?.contextLength || 32768)
  const value = Math.min(settings.modelContextLengths?.[model] || maximum, maximum)
  const update = (next: number) => {
    const modelContextLengths = { ...(settings.modelContextLengths || {}), [model]: next }
    onUpdateSettings({ modelContextLengths })
  }

  return (
    <label className="block space-y-1 text-[10px] text-slate-400">
      <span className="flex justify-between">
        <span>Context window (ctx)</span>
        <span className="font-mono text-slate-300">{value.toLocaleString()} / {maximum.toLocaleString()}</span>
      </span>
      <input
        aria-label={`Context window for ${model}`}
        type="range"
        min={4096}
        max={maximum}
        step={1024}
        value={value}
        onChange={(event) => update(Number(event.target.value))}
        className="w-full accent-cyan-400"
      />
    </label>
  )
}
