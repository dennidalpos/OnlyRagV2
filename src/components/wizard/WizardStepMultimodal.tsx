import React, { useState } from 'react'
import { Eye, Database, FileText } from 'lucide-react'
import { ModelRecommendation } from '../../services/hardwareRecommendationEngine'
import { ModelOptionCard } from './ModelOptionCard'
import { useTranslation } from '../../i18n'

export interface WizardStepMultimodalProps {
  selectedVision: string
  onSelectVision: (m: string) => void
  selectedEmbedding: string
  onSelectEmbedding: (m: string) => void
  visionTierModels: ModelRecommendation[]
  embeddingTierModels: ModelRecommendation[]
  downloadedModels: string[]
  isModelDownloaded: (name: string) => boolean
}

export const WizardStepMultimodal: React.FC<WizardStepMultimodalProps> = ({
  selectedVision,
  onSelectVision,
  selectedEmbedding,
  onSelectEmbedding,
  visionTierModels,
  embeddingTierModels,
  downloadedModels,
  isModelDownloaded,
}) => {
  const { t } = useTranslation()
  const [subTab, setSubTab] = useState<'vision' | 'embedding'>('vision')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div>
          <h3 className="text-xs font-bold text-slate-100 flex items-center gap-2 uppercase tracking-wider">
            <FileText className="w-4 h-4 text-amber-400" /> {t('settings.ingestionOcrSection')}
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {t('settings.ingestionOcrSubtitle')}
          </p>
        </div>
      </div>

      {/* Segmented Sub-Tab Switcher to prevent hidden vertical scroll sections */}
      <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
        <button
          type="button"
          onClick={() => setSubTab('vision')}
          className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer focus-ring ${
            subTab === 'vision'
              ? 'bg-amber-950/90 text-amber-300 border border-amber-500/50 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
          <span>1. {t('hardwareWizard.step5Vision')}</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('embedding')}
          className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer focus-ring ${
            subTab === 'embedding'
              ? 'bg-purple-950/90 text-purple-300 border border-purple-500/50 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>2. {t('hardwareWizard.step5Embedding')}</span>
        </button>
      </div>

      {/* Vision & Multimodal OCR Model */}
      {subTab === 'vision' && (
        <div className="space-y-2.5 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
          <div className="flex items-center justify-between text-amber-300">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4" />
              <h4 className="text-xs font-bold uppercase tracking-wider">{t('hardwareWizard.step5Vision')}</h4>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              Selezionato: <strong className="text-amber-300">{selectedVision || 'Nessuno'}</strong>
            </span>
          </div>

          <div className="space-y-1.5" role="radiogroup" aria-label={t('hardwareWizard.step5Vision')}>
            {visionTierModels.map((m) => (
              <ModelOptionCard
                key={m.modelName}
                modelName={m.modelName}
                displayName={m.displayName}
                description={m.description}
                sizeBytesApprox={m.sizeBytesApprox}
                family={m.family}
                isRecommended={m.isRecommended}
                isInstalled={isModelDownloaded(m.modelName)}
                isSelected={selectedVision === m.modelName}
                onSelect={() => onSelectVision(m.modelName)}
                accentColor="amber"

                compatibilityStatus={m.compatibilityStatus}
                compatibilityWarning={m.compatibilityWarning}
              />
            ))}

            {/* Any installed local models matching vision */}
            {downloadedModels
              .filter(
                (dm) =>
                  !visionTierModels.some((vm) => vm.modelName === dm || dm.startsWith(vm.modelName.split(':')[0])) &&
                  (dm.includes('vision') || dm.includes('vl') || dm.includes('minicpm') || dm.includes('llava') || dm.includes('moondream'))
              )
              .map((dm) => (
                <ModelOptionCard
                  key={dm}
                  modelName={dm}
                  displayName={dm}
                  description={t('hardwareWizard.customLocalModel')}
                  isInstalled={true}
                  isSelected={selectedVision === dm}
                  onSelect={() => onSelectVision(dm)}
                  accentColor="amber"
                />
              ))}
          </div>
        </div>
      )}

      {/* Vector Embedding Model */}
      {subTab === 'embedding' && (
        <div className="space-y-2.5 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
          <div className="flex items-center justify-between text-purple-300">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4" />
              <h4 className="text-xs font-bold uppercase tracking-wider">{t('hardwareWizard.step5Embedding')}</h4>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              Selezionato: <strong className="text-purple-300">{selectedEmbedding || 'Nessuno'}</strong>
            </span>
          </div>

          <div className="space-y-1.5" role="radiogroup" aria-label={t('hardwareWizard.step5Embedding')}>
            {embeddingTierModels.map((m) => (
              <ModelOptionCard
                key={m.modelName}
                modelName={m.modelName}
                displayName={m.displayName}
                description={m.description}
                sizeBytesApprox={m.sizeBytesApprox}
                family={m.family}
                isRecommended={m.isRecommended}
                isInstalled={isModelDownloaded(m.modelName)}
                isSelected={selectedEmbedding === m.modelName}
                onSelect={() => onSelectEmbedding(m.modelName)}
                accentColor="purple"

                compatibilityStatus={m.compatibilityStatus}
                compatibilityWarning={m.compatibilityWarning}
              />
            ))}

            {/* Any installed local models matching embedding */}
            {downloadedModels
              .filter(
                (dm) =>
                  !embeddingTierModels.some((em) => em.modelName === dm) &&
                  (dm.includes('embed') || dm.includes('bge') || dm.includes('nomic') || dm.includes('minilm'))
              )
              .map((dm) => (
                <ModelOptionCard
                  key={dm}
                  modelName={dm}
                  displayName={dm}
                  description={t('hardwareWizard.customLocalModel')}
                  isInstalled={true}
                  isSelected={selectedEmbedding === dm}
                  onSelect={() => onSelectEmbedding(dm)}
                  accentColor="purple"
                />
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
