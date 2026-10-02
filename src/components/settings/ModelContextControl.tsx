import React from 'react'
import type { OllamaModelMetrics, AppSettings, DiagnosticsData } from '../../types'
import { getModelContextChoices, resolveModelContextLength } from '../../../shared/domain/settings/modelContextPreference'
import { extractHardwareFacts, formatModelFit } from '../../services/hardwareRecommendationEngine'
import { assessModelRuntimeFit } from '../../../shared/domain/hardware/modelRuntimeFit'
import { isLocalOllamaHost } from '../../../shared/domain/ollamaHost'
import { useTranslation } from '../../i18n'

interface ModelContextControlProps {
  model: string
  settings: AppSettings
  metrics?: OllamaModelMetrics
  hardwareDefault: number
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void
  diagnostics?: DiagnosticsData | null
}

export const ModelContextControl: React.FC<ModelContextControlProps> = ({ model, settings, metrics, hardwareDefault, onUpdateSettings, diagnostics }) => {
  const { t } = useTranslation()
  if (!model) return null
  const maximum = metrics?.contextLength
  const choices = getModelContextChoices(maximum)
  const value = resolveModelContextLength(model, settings.modelContextLengths, hardwareDefault, maximum)
  const update = (next: number) => {
    const modelContextLengths = { ...(settings.modelContextLengths || {}), [model]: next }
    onUpdateSettings({ modelContextLengths })
  }

  return (
    <label className="block space-y-1 text-[10px] text-slate-400">
      <span className="flex justify-between">
        <span>Context window (ctx)</span>
        <span className="font-mono text-slate-300">
          {value.toLocaleString()} / {maximum ? maximum.toLocaleString() : 'MAX'}
        </span>
      </span>
      <span className="block text-xs text-amber-300">
        {formatModelFit(
          assessModelRuntimeFit(
            model,
            value,
            diagnostics && settings.ollamaMode !== 'remote' && isLocalOllamaHost(settings.ollamaHost) ? extractHardwareFacts(diagnostics) : undefined,
            metrics,
          ),
        )}
      </span>
      <span className="block text-xs">{t('hardwareWizard.memoryHint')}</span>
      <span className="flex flex-wrap gap-1">
        {choices.map((choice) => (
          <button
            key={choice}
            type="button"
            onClick={() => update(choice)}
            className={choice === value ? 'rounded px-1.5 py-0.5 bg-cyan-500 text-slate-950 font-bold' : 'rounded px-1.5 py-0.5 bg-slate-800 text-slate-300'}
          >
            {choice === maximum ? 'MAX' : `${choice / 1024}K`}
          </button>
        ))}
      </span>
    </label>
  )
}
