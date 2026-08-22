import React from 'react'
import { Cpu, Check } from 'lucide-react'
import { AppSettings } from '../../types'
import { useTranslation } from '../../i18n'
import { getHardwareProfileDefs } from '../../constants/hardwareProfiles'
import { ToggleSwitch } from '../common/ToggleSwitch'

interface HardwareProfileSelectorProps {
  settings: AppSettings
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void
}

export const HardwareProfileSelector: React.FC<HardwareProfileSelectorProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const { t } = useTranslation()
  const profiles = getHardwareProfileDefs(t)

  return (
    <div className="glass-panel rounded-xl p-5 border border-slate-800 space-y-3">
      <div className="flex items-center gap-3">
        <Cpu className="w-5 h-5 text-cyan-400" />
        <div>
          <h2 className="text-base font-semibold text-slate-100">{t('settings.hardwareProfile')}</h2>
          <p className="text-xs text-slate-400">{t('settings.hardwareProfileDesc')}</p>
        </div>
      </div>

      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3"
        role="radiogroup"
        aria-label="Hardware profile selection"
      >
        {profiles.map((p) => (
          <button
            type="button"
            key={p.id}
            role="radio"
            tabIndex={settings.hardwareProfile === p.id ? 0 : -1}
            aria-checked={settings.hardwareProfile === p.id}
            onClick={() => onUpdateSettings({ hardwareProfile: p.id })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onUpdateSettings({ hardwareProfile: p.id })
              }
            }}
            className={`p-3.5 rounded-xl border cursor-pointer flex flex-col justify-between transition-all select-none text-left focus-ring active:scale-[0.98] ${
              settings.hardwareProfile === p.id
                ? 'bg-cyan-950/50 border-cyan-500 shadow-md shadow-cyan-950/30'
                : 'bg-slate-900/70 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div>
              <div className="flex items-center justify-between font-semibold text-slate-100 text-xs">
                <span>{p.name}</span>
                {settings.hardwareProfile === p.id && <Check className="w-4 h-4 text-cyan-400" />}
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">{p.desc}</p>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono">
              <span className="text-slate-400">{t('settings.hardwareProfileTargetLabel')}:</span>
              <span className="text-cyan-300 font-semibold">{p.vram}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Hybrid System RAM Offloading Switch */}
      <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-4">
        <div className="space-y-0.5 max-w-xl">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-200">
              {t('settings.enableSystemRamOffloadingTitle')}
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-950/80 text-cyan-400 border border-cyan-800/60">
              Hybrid GPU + RAM
            </span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {t('settings.enableSystemRamOffloadingDesc')}
          </p>
        </div>
        <ToggleSwitch
          checked={Boolean(settings.enableSystemRamOffloading)}
          onChange={(checked) => onUpdateSettings({ enableSystemRamOffloading: checked })}
          ariaLabel={t('settings.enableSystemRamOffloadingTitle')}
        />
      </div>
    </div>
  )
}
