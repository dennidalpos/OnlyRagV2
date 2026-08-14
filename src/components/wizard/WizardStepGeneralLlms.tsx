import React from 'react'
import { MessageSquare, Languages, Sparkles } from 'lucide-react'
import { ModelRecommendation } from '../../services/hardwareRecommendationEngine'
import { ModelOptionCard } from './ModelOptionCard'
import { useTranslation } from '../../i18n'

export interface WizardStepGeneralLlmsProps {
  selectedChat: string
  onSelectChat: (m: string) => void
  selectedTranslation: string
  onSelectTranslation: (m: string) => void
  chatTierModels: ModelRecommendation[]
  translationTierModels: ModelRecommendation[]
  downloadedModels: string[]
  isModelDownloaded: (name: string) => boolean
}

export const WizardStepGeneralLlms: React.FC<WizardStepGeneralLlmsProps> = ({
  selectedChat,
  onSelectChat,
  selectedTranslation,
  onSelectTranslation,
  chatTierModels,
  translationTierModels,
  downloadedModels,
  isModelDownloaded,
}) => {
  const { t } = useTranslation()

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-bold text-slate-100 flex items-center gap-2 uppercase tracking-wider">
          <Sparkles className="w-4 h-4 text-cyan-400" /> {t('hardwareWizard.stepGeneralLlmTitle')}
        </h3>
        <p className="text-[11px] text-slate-400 mt-0.5">
          {t('hardwareWizard.stepGeneralLlmDesc')}
        </p>
      </div>

      {/* RAG Chat & Document Q&A Model */}
      <div className="space-y-2.5 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
        <div className="flex items-center gap-2 text-cyan-300">
          <MessageSquare className="w-4 h-4" />
          <h4 className="text-xs font-bold uppercase tracking-wider">{t('hardwareWizard.chatModelTitle')}</h4>
        </div>
        <p className="text-[11px] text-slate-400">{t('hardwareWizard.chatModelDesc')}</p>

        <div className="space-y-1.5" role="radiogroup" aria-label={t('hardwareWizard.chatModelTitle')}>
          {chatTierModels.map((m) => (
            <ModelOptionCard
              key={m.modelName}
              modelName={m.modelName}
              displayName={m.displayName}
              description={m.description}
              sizeBytesApprox={m.sizeBytesApprox}
              isRecommended={m.isRecommended}
              isInstalled={isModelDownloaded(m.modelName)}
              isSelected={selectedChat === m.modelName}
              onSelect={() => onSelectChat(m.modelName)}
              accentColor="cyan"
            />
          ))}

          {/* Any installed local models not in presets */}
          {downloadedModels
            .filter((dm) => !chatTierModels.some((m) => m.modelName === dm))
            .map((dm) => (
              <ModelOptionCard
                key={dm}
                modelName={dm}
                displayName={dm}
                description={t('hardwareWizard.customLocalModel')}
                sizeBytesApprox="Local"
                isInstalled={true}
                isSelected={selectedChat === dm}
                onSelect={() => onSelectChat(dm)}
                accentColor="cyan"
              />
            ))}
        </div>
      </div>

      {/* Document Translation Model */}
      <div className="space-y-2.5 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
        <div className="flex items-center gap-2 text-sky-300">
          <Languages className="w-4 h-4" />
          <h4 className="text-xs font-bold uppercase tracking-wider">{t('hardwareWizard.translationModelTitle')}</h4>
        </div>
        <p className="text-[11px] text-slate-400">{t('hardwareWizard.translationModelDesc')}</p>

        <div className="space-y-1.5" role="radiogroup" aria-label={t('hardwareWizard.translationModelTitle')}>
          {translationTierModels.map((m) => (
            <ModelOptionCard
              key={m.modelName}
              modelName={m.modelName}
              displayName={m.displayName}
              description={m.description}
              sizeBytesApprox={m.sizeBytesApprox}
              isRecommended={m.isRecommended}
              isInstalled={isModelDownloaded(m.modelName)}
              isSelected={selectedTranslation === m.modelName}
              onSelect={() => onSelectTranslation(m.modelName)}
              accentColor="sky"
            />
          ))}

          {/* Any installed local models not in presets */}
          {downloadedModels
            .filter((dm) => !translationTierModels.some((m) => m.modelName === dm))
            .map((dm) => (
              <ModelOptionCard
                key={dm}
                modelName={dm}
                displayName={dm}
                description={t('hardwareWizard.customLocalModel')}
                sizeBytesApprox="Local"
                isInstalled={true}
                isSelected={selectedTranslation === dm}
                onSelect={() => onSelectTranslation(dm)}
                accentColor="sky"
              />
            ))}
        </div>
      </div>
    </div>
  )
}
