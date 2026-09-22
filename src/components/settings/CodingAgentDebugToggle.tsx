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
    <>
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
      {settings.enableCodingAgentDebugLog === true && (
        <div className="flex items-center justify-between gap-3 border-t border-slate-800 pt-4 pl-3">
          <div>
            <div className="text-xs font-semibold text-slate-200">{t('settings.codingAgentDebugPayloads')}</div>
            <div className="text-[11px] text-slate-500">{t('settings.codingAgentDebugPayloadsDesc')}</div>
          </div>
          <ToggleSwitch
            checked={settings.includeCodingAgentDebugPayloads === true}
            onChange={(checked) => onUpdateSettings({ includeCodingAgentDebugPayloads: checked })}
            activeColor="bg-amber-500"
            ariaLabel={t('settings.codingAgentDebugPayloads')}
          />
        </div>
      )}
    </>
  )
}
