import React from 'react'
import { Scan, Check } from 'lucide-react'
import { AppSettings } from '../../types'
import { useTranslation } from '../../i18n'

interface OcrEngineSelectorProps {
  settings: AppSettings
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void
}

/**
 * Settings-page OCR engine picker. Mirrors the Wizard Step 5 card (same i18n
 * keys and options) so users who skip the wizard — or want to change it later —
 * aren't forced back into the wizard to switch native_cuda vs vision_model OCR.
 */
export const OcrEngineSelector: React.FC<OcrEngineSelectorProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const { t } = useTranslation()
  const engines: { id: AppSettings['ocrEngine']; icon: string; name: string; desc: string }[] = [
    { id: 'native_cuda', icon: '⚡', name: t('hardwareWizard.nativeCudaOcr'), desc: t('hardwareWizard.nativeCudaOcrDesc') },
    { id: 'vision_model', icon: '👁️', name: t('hardwareWizard.visionModelOcr'), desc: t('hardwareWizard.visionModelOcrDesc') },
  ]

  return (
    <div className="glass-panel rounded-xl p-5 border border-slate-800 space-y-3">
      <div className="flex items-center gap-3">
        <Scan className="w-5 h-5 text-amber-400" />
        <div>
          <h2 className="text-base font-semibold text-slate-100">{t('hardwareWizard.ocrEngineSection')}</h2>
        </div>
      </div>

      <div
        className="grid grid-cols-1 md:grid-cols-2 gap-3"
        role="radiogroup"
        aria-label={t('hardwareWizard.ocrEngineSection')}
      >
        {engines.map((engine) => {
          const isSelected = settings.ocrEngine === engine.id
          return (
            <button
              type="button"
              key={engine.id}
              role="radio"
              tabIndex={isSelected ? 0 : -1}
              aria-checked={isSelected}
              onClick={() => onUpdateSettings({ ocrEngine: engine.id })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onUpdateSettings({ ocrEngine: engine.id })
                }
              }}
              className={`p-3.5 rounded-xl border cursor-pointer flex flex-col justify-between transition-all select-none text-left focus-ring active:scale-[0.98] ${
                isSelected
                  ? 'bg-amber-950/50 border-amber-400 shadow-md shadow-amber-950/30'
                  : 'bg-slate-900/70 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between font-semibold text-slate-100 text-xs">
                <span>{engine.icon} {engine.name}</span>
                {isSelected && <Check className="w-4 h-4 text-amber-400" />}
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">{engine.desc}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
