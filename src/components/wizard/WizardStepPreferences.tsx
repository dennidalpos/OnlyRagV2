import React from 'react'
import { Sliders, Cpu, Scan, Check, Layers, Volume2, VolumeX } from 'lucide-react'
import { HardwareProfile } from '../../types'
import { useTranslation } from '../../i18n'
import { getHardwareProfileDefs } from '../../constants/hardwareProfiles'

export interface WizardStepPreferencesProps {
  hardwareProfile: HardwareProfile
  onSelectHardwareProfile: (profile: HardwareProfile) => void
  ocrEngine: 'native_cuda' | 'vision_model'
  onSelectOcrEngine: (engine: 'native_cuda' | 'vision_model') => void
  maxToolCallSteps: number
  onChangeMaxToolCallSteps: (steps: number) => void
  enableSystemRamOffloading?: boolean
  onToggleSystemRamOffloading?: (enabled: boolean) => void
  enableSoundEffects?: boolean
  onToggleSoundEffects?: (enabled: boolean) => void
}

export const WizardStepPreferences: React.FC<WizardStepPreferencesProps> = ({
  hardwareProfile,
  onSelectHardwareProfile,
  ocrEngine,
  onSelectOcrEngine,
  maxToolCallSteps,
  onChangeMaxToolCallSteps,
  enableSystemRamOffloading = false,
  onToggleSystemRamOffloading,
  enableSoundEffects = true,
  onToggleSoundEffects,
}) => {
  const { t } = useTranslation()

  const profiles = getHardwareProfileDefs(t)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <Sliders className="w-4 h-4 text-cyan-400" /> {t('hardwareWizard.runtimePrefsTitle')}
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          {t('hardwareWizard.runtimePrefsDesc')}
        </p>
      </div>

      {/* Hybrid System RAM Offloading (GPU + RAM) */}
      <div className="space-y-3 p-4 rounded-xl bg-slate-950/60 border border-slate-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-2">
              <Cpu className="w-4 h-4" /> {t('settings.enableSystemRamOffloadingTitle')}
            </h4>
            <p className="text-[11px] text-slate-400 leading-relaxed max-w-xl">
              {t('settings.enableSystemRamOffloadingDesc')}
            </p>
          </div>
          {onToggleSystemRamOffloading && (
            <button
              type="button"
              role="switch"
              aria-checked={enableSystemRamOffloading}
              onClick={() => onToggleSystemRamOffloading(!enableSystemRamOffloading)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-ring ${
                enableSystemRamOffloading ? 'bg-cyan-500' : 'bg-slate-700'
              }`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  enableSystemRamOffloading ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          )}
        </div>
      </div>

      {/* Hardware Profile Selector — shares copy with Settings > HardwareProfileSelector */}
      <div className="space-y-3 p-4 rounded-xl bg-slate-950/60 border border-slate-800">
        <div className="flex items-center gap-2 text-cyan-300">
          <Cpu className="w-4 h-4" />
          <h4 className="text-xs font-bold uppercase tracking-wider">{t('hardwareWizard.hardwareProfileSection')}</h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {profiles.map((p) => {
            const isSelected = hardwareProfile === p.id
            return (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectHardwareProfile(p.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelectHardwareProfile(p.id)
                  }
                }}
                className={`p-3 rounded-xl border cursor-pointer transition-all focus-ring ${
                  isSelected
                    ? 'bg-cyan-950/40 border-cyan-400 shadow-md'
                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-xs text-slate-200 flex items-center gap-2">
                    <div
                      className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                        isSelected ? 'border-cyan-400 bg-cyan-500' : 'border-slate-600'
                      }`}
                    >
                      {isSelected && <Check className="w-2.5 h-2.5 text-slate-950 font-bold" />}
                    </div>
                    <span>{p.name}</span>
                  </div>
                  <span className="text-[10px] font-mono text-cyan-300/90">{p.vram}</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 pl-5.5">{p.desc}</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Agent Execution Limits — shares the same setting as Settings > AgentExecutionLimitsConfig */}
      <div className="space-y-3 p-4 rounded-xl bg-slate-950/60 border border-slate-800">
        <div className="flex items-center gap-2 text-cyan-300">
          <Layers className="w-4 h-4" />
          <h4 className="text-xs font-bold uppercase tracking-wider">{t('settings.executionLimitsSection')}</h4>
        </div>
        <p className="text-[11px] text-slate-400 -mt-1.5">{t('settings.executionLimitsDesc')}</p>

        {/* Max Tool Call Steps */}
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
              value={maxToolCallSteps === 0 || maxToolCallSteps >= 200 ? 200 : maxToolCallSteps || 50}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10)
                onChangeMaxToolCallSteps(val >= 200 ? 0 : val)
              }}
              className="w-32 accent-cyan-400 bg-slate-900 cursor-pointer"
              aria-label={t('settings.toolCallStepsTitle')}
            />
            <span className="text-xs font-mono font-bold text-cyan-300 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 min-w-[70px] text-center shadow-inner">
              {maxToolCallSteps === 0 || maxToolCallSteps >= 200
                ? t('settings.toolCallStepsUnlimited')
                : t('settings.toolCallStepsValue', { steps: maxToolCallSteps || 50 })}
            </span>
          </div>
        </div>
      </div>

      {/* OCR Engine Preference */}
      <div className="space-y-3 p-4 rounded-xl bg-slate-950/60 border border-slate-800">
        <div className="flex items-center gap-2 text-amber-300">
          <Scan className="w-4 h-4" />
          <h4 className="text-xs font-bold uppercase tracking-wider">{t('hardwareWizard.ocrEngineSection')}</h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div
            role="button"
            tabIndex={0}
            onClick={() => onSelectOcrEngine('native_cuda')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelectOcrEngine('native_cuda')
              }
            }}
            className={`p-3.5 rounded-xl border cursor-pointer transition-all focus-ring ${
              ocrEngine === 'native_cuda'
                ? 'bg-amber-950/40 border-amber-400 shadow-md'
                : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center gap-2 font-semibold text-xs text-slate-200">
              <div
                className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                  ocrEngine === 'native_cuda' ? 'border-amber-400 bg-amber-500' : 'border-slate-600'
                }`}
              >
                {ocrEngine === 'native_cuda' && <Check className="w-2.5 h-2.5 text-slate-950 font-bold" />}
              </div>
              <span>⚡ {t('hardwareWizard.nativeCudaOcr')}</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 pl-5.5">
              {t('hardwareWizard.nativeCudaOcrDesc')}
            </p>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onSelectOcrEngine('vision_model')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelectOcrEngine('vision_model')
              }
            }}
            className={`p-3.5 rounded-xl border cursor-pointer transition-all focus-ring ${
              ocrEngine === 'vision_model'
                ? 'bg-amber-950/40 border-amber-400 shadow-md'
                : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center gap-2 font-semibold text-xs text-slate-200">
              <div
                className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                  ocrEngine === 'vision_model' ? 'border-amber-400 bg-amber-500' : 'border-slate-600'
                }`}
              >
                {ocrEngine === 'vision_model' && <Check className="w-2.5 h-2.5 text-slate-950 font-bold" />}
              </div>
              <span>👁️ {t('hardwareWizard.visionModelOcr')}</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 pl-5.5">
              {t('hardwareWizard.visionModelOcrDesc')}
            </p>
          </div>
        </div>
      </div>

      {/* Sound Effects Preference */}
      <div className="space-y-3 p-4 rounded-xl bg-slate-950/60 border border-slate-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-2">
              {enableSoundEffects ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
              {t('settings.soundEffects')}
            </h4>
            <p className="text-[11px] text-slate-400 leading-relaxed max-w-xl">
              {t('settings.soundEffectsDesc')}
            </p>
          </div>
          {onToggleSoundEffects && (
            <button
              type="button"
              role="switch"
              aria-checked={enableSoundEffects}
              onClick={() => onToggleSoundEffects(!enableSoundEffects)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-ring ${
                enableSoundEffects ? 'bg-cyan-500' : 'bg-slate-700'
              }`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  enableSoundEffects ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
