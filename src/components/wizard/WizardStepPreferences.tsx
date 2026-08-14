import React from 'react'
import { Sliders, Cpu, Scan, Check } from 'lucide-react'
import { HardwareProfile } from '../../types'
import { useTranslation } from '../../i18n'

export interface WizardStepPreferencesProps {
  hardwareProfile: HardwareProfile
  onSelectHardwareProfile: (profile: HardwareProfile) => void
  ocrEngine: 'native_cuda' | 'vision_model'
  onSelectOcrEngine: (engine: 'native_cuda' | 'vision_model') => void
  maxConcurrentTasks: number
  onChangeMaxConcurrentTasks: (tasks: number) => void
}

export const WizardStepPreferences: React.FC<WizardStepPreferencesProps> = ({
  hardwareProfile,
  onSelectHardwareProfile,
  ocrEngine,
  onSelectOcrEngine,
  maxConcurrentTasks,
  onChangeMaxConcurrentTasks,
}) => {
  const { t } = useTranslation()

  const profiles: { id: HardwareProfile; title: string; desc: string }[] = [
    { id: 'Auto', title: 'Auto (Consigliato)', desc: 'Adatta dinamicamente il contesto e i thread alle risorse CPU, RAM e GPU VRAM rilevate.' },
    { id: 'Low', title: 'Low Spec (CPU / <4GB)', desc: 'Ottimizzato per laptop senza GPU dedicata o con memoria limitata (4-8GB RAM).' },
    { id: 'Medium', title: 'Mid-Range (6-8GB VRAM)', desc: 'Bilanciamento ideale per GPU gaming (RTX 3060/4060 o 16GB RAM).' },
    { id: 'High', title: 'High-End (12GB+ VRAM)', desc: 'Massima ampiezza di contesto e concorrenza per GPU dedicate (RTX 3080/4070/4080/4090).' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <Sliders className="w-4 h-4 text-cyan-400" /> Runtime Preferences & Performance Engine
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Fine-tune hardware memory profiles, parallel concurrency limits, and OCR parsing behavior.
        </p>
      </div>

      {/* Hardware Profile Selector */}
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
                    <span>{p.title}</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 pl-5.5">{p.desc}</p>
              </div>
            )
          })}
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
              PyMuPDF direct stream text extraction & layout vector bounding boxes. Ultra-fast and lightweight.
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
              Deep multimodal visual analysis for complex scanned PDFs, handwritten notes, charts, and diagrams.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
