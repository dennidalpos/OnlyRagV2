import React from 'react'
import type { AppSettings, OllamaModelMetrics, OllamaThinkValue } from '../../types'
import { resolveOllamaThinkingPreference, updateModelThinkingPreference } from '../../../shared/domain/agent/ollamaThinkingPolicy'
import { useTranslation } from '../../i18n'
import { ToggleSwitch } from '../common/ToggleSwitch'

interface ModelThinkingControlProps {
  modelName: string
  metrics: Record<string, OllamaModelMetrics>
  settings: AppSettings
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void
}

export const ModelThinkingControl: React.FC<ModelThinkingControlProps> = ({ modelName, metrics, settings, onUpdateSettings }) => {
  const { t } = useTranslation()
  const resolution = resolveOllamaThinkingPreference(modelName, settings, metrics)

  if (resolution.levels.length > 0 && resolution.installedModel) {
    const installedModel = resolution.installedModel
    const stored = settings.modelThinkingPreferences?.[installedModel]
    const choices: { value: OllamaThinkValue | undefined; label: string }[] = [
      { value: undefined, label: t('settings.thinkingModelDefault') + (resolution.modelDefault !== undefined ? ` (${String(resolution.modelDefault)})` : '') },
      ...(resolution.mode === 'binary' ? [{ value: false as OllamaThinkValue, label: t('settings.thinkingOff') }] : []),
      ...resolution.levels.map((level) => ({ value: level as OllamaThinkValue, label: level })),
    ]
    return (
      <div className="space-y-1 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2">
        <div className="text-[10px] font-semibold text-slate-200">{t('settings.thinkingLabel')}</div>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`${t('settings.thinkingLabel')} ${modelName}`}>
          {choices.map((choice) => {
            const selected = choice.value === stored
            return (
              <button
                key={String(choice.value)}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() =>
                  onUpdateSettings({ modelThinkingPreferences: updateModelThinkingPreference(settings.modelThinkingPreferences, installedModel, choice.value) })
                }
                className={
                  selected
                    ? 'rounded px-1.5 py-0.5 text-[10px] bg-violet-500 text-slate-950 font-bold'
                    : 'rounded px-1.5 py-0.5 text-[10px] bg-slate-800 text-slate-300'
                }
              >
                {choice.label}
              </button>
            )
          })}
        </div>
        <div className="text-[9px] text-slate-500">{t('settings.thinkingLevelHint')}</div>
      </div>
    )
  }

  if (resolution.mode !== 'binary' || !resolution.installedModel) return null

  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2">
      <div>
        <div className="text-[10px] font-semibold text-slate-200">{t('settings.thinkingLabel')}</div>
        <div className="text-[9px] text-slate-500">{resolution.enabled ? t('settings.thinkingEnabled') : t('settings.thinkingDisabled')}</div>
      </div>
      <ToggleSwitch
        checked={resolution.enabled}
        onChange={(enabled) =>
          onUpdateSettings({
            modelThinkingPreferences: updateModelThinkingPreference(settings.modelThinkingPreferences, resolution.installedModel!, enabled),
          })
        }
        activeColor="bg-violet-500"
        ariaLabel={`${t('settings.thinkingLabel')} ${modelName}`}
      />
    </div>
  )
}
