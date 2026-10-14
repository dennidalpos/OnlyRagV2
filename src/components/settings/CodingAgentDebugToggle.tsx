import type { AppSettings } from '../../types'
import { useTranslation } from '../../i18n'
import { ToggleSwitch } from '../common/ToggleSwitch'

interface CodingAgentDebugToggleProps {
  settings: AppSettings
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void
}

export function CodingAgentDebugToggle({ settings, onUpdateSettings }: CodingAgentDebugToggleProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div className="space-y-1">
        <h3 className="text-sm font-bold text-slate-100">{t('settings.codingAgentDebugLog')}</h3>
        <p className="text-xs text-slate-400 max-w-2xl">{t('settings.codingAgentDebugLogDesc')}</p>
      </div>
      <ToggleSwitch
        checked={settings.enableCodingAgentDebugLog === true}
        onChange={(checked) => onUpdateSettings({ enableCodingAgentDebugLog: checked })}
        activeColor="bg-emerald-500"
        ariaLabel={t('settings.codingAgentDebugLog')}
      />
    </div>
  )
}
