import React from 'react'
import type { AppSettings, OllamaModelMetrics } from '../../types'
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

  if (resolution.mode === 'level-only') {
    return (
      <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-2.5 py-2 text-[10px] text-amber-200">{t('settings.thinkingLevelOnlyNote')}</div>
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
