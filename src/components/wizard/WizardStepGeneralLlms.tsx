import React, { useState } from 'react'
import { MessageSquare, Languages, Sparkles, Activity, Scale, XCircle } from 'lucide-react'
import { ModelRecommendation } from '../../services/hardwareRecommendationEngine'
import { ModelOptionCard } from './ModelOptionCard'
import { useTranslation } from '../../i18n'

export interface WizardStepGeneralLlmsProps {
  selectedChat: string
  onSelectChat: (m: string) => void
  selectedTranslation: string
  onSelectTranslation: (m: string) => void
  selectedMedical?: string
  onSelectMedical?: (m: string) => void
  selectedLegal?: string
  onSelectLegal?: (m: string) => void
  chatTierModels: ModelRecommendation[]
  translationTierModels: ModelRecommendation[]
  medicalTierModels?: ModelRecommendation[]
  legalTierModels?: ModelRecommendation[]
  downloadedModels: string[]
  isModelDownloaded: (name: string) => boolean
}

export const WizardStepGeneralLlms: React.FC<WizardStepGeneralLlmsProps> = ({
  selectedChat,
  onSelectChat,
  selectedTranslation,
  onSelectTranslation,
  selectedMedical = '',
  onSelectMedical,
  selectedLegal = '',
  onSelectLegal,
  chatTierModels,
  translationTierModels,
  medicalTierModels = [],
  legalTierModels = [],
  downloadedModels,
  isModelDownloaded,
}) => {
  const { t } = useTranslation()
  const [subTab, setSubTab] = useState<'chat' | 'translation' | 'medical' | 'legal'>('chat')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div>
          <h3 className="text-xs font-bold text-slate-100 flex items-center gap-2 uppercase tracking-wider">
            <Sparkles className="w-4 h-4 text-cyan-400" /> {t('hardwareWizard.stepGeneralLlmTitle')}
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {t('hardwareWizard.stepGeneralLlmDesc')}
          </p>
        </div>
      </div>

      {/* Segmented Sub-Tab Switcher for 4 areas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
        <button
          type="button"
          onClick={() => setSubTab('chat')}
          className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer focus-ring min-w-0 ${
            subTab === 'chat'
              ? 'bg-cyan-950/90 text-cyan-300 border border-cyan-500/60 shadow-sm shadow-cyan-950/40 ring-1 ring-cyan-400/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
          }`}
          title="1. Modello RAG Chat & Q&A Documentale"
        >
          <MessageSquare className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
          <span>1. Chat RAG</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('translation')}
          className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer focus-ring min-w-0 ${
            subTab === 'translation'
              ? 'bg-sky-950/90 text-sky-300 border border-sky-500/60 shadow-sm shadow-sky-950/40 ring-1 ring-sky-400/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
          }`}
          title="2. Modello Traduzione Documenti"
        >
          <Languages className="w-3.5 h-3.5 shrink-0 text-sky-400" />
          <span>2. Traduzione</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('medical')}
          className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer focus-ring min-w-0 ${
            subTab === 'medical'
              ? 'bg-rose-950/90 text-rose-300 border border-rose-500/60 shadow-sm shadow-rose-950/40 ring-1 ring-rose-400/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
          }`}
          title="3. Modello Medico & Sanitario"
        >
          <Activity className="w-3.5 h-3.5 shrink-0 text-rose-400" />
          <span>3. Medico</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('legal')}
          className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer focus-ring min-w-0 ${
            subTab === 'legal'
              ? 'bg-amber-950/90 text-amber-300 border border-amber-500/60 shadow-sm shadow-amber-950/40 ring-1 ring-amber-400/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
          }`}
          title="4. Modello Legale & Normativo"
        >
          <Scale className="w-3.5 h-3.5 shrink-0 text-amber-400" />
          <span>4. Legale</span>
        </button>
      </div>

      {/* RAG Chat & Document Q&A Model */}
      {subTab === 'chat' && (
        <div className="space-y-2.5 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
          <div className="flex items-center justify-between text-cyan-300">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-cyan-400" />
              <h4 className="text-xs font-bold uppercase tracking-wider">{t('hardwareWizard.chatModelTitle')}</h4>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              Selezionato: <strong className="text-cyan-300">{selectedChat || 'Nessuno'}</strong>
            </span>
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
                family={m.family}
                isRecommended={m.isRecommended}
                isInstalled={isModelDownloaded(m.modelName)}
                isSelected={selectedChat === m.modelName}
                onSelect={() => onSelectChat(m.modelName)}
                accentColor="cyan"

                compatibilityStatus={m.compatibilityStatus}
                compatibilityWarning={m.compatibilityWarning}
              />
            ))}

            {downloadedModels
              .filter((dm) => !chatTierModels.some((m) => m.modelName === dm))
              .map((dm) => (
                <ModelOptionCard
                  key={dm}
                  modelName={dm}
                  displayName={dm}
                  description={t('hardwareWizard.customLocalModel')}
                  isInstalled={true}
                  isSelected={selectedChat === dm}
                  onSelect={() => onSelectChat(dm)}
                  accentColor="cyan"
                />
              ))}
          </div>
        </div>
      )}

      {/* Document Translation Model */}
      {subTab === 'translation' && (
        <div className="space-y-2.5 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
          <div className="flex items-center justify-between text-sky-300">
            <div className="flex items-center gap-2">
              <Languages className="w-4 h-4 text-sky-400" />
              <h4 className="text-xs font-bold uppercase tracking-wider">{t('hardwareWizard.translationModelTitle')}</h4>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              Selezionato: <strong className="text-sky-300">{selectedTranslation || 'Nessuno'}</strong>
            </span>
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
                family={m.family}
                isRecommended={m.isRecommended}
                isInstalled={isModelDownloaded(m.modelName)}
                isSelected={selectedTranslation === m.modelName}
                onSelect={() => onSelectTranslation(m.modelName)}
                accentColor="sky"

                compatibilityStatus={m.compatibilityStatus}
                compatibilityWarning={m.compatibilityWarning}
              />
            ))}

            {downloadedModels
              .filter((dm) => !translationTierModels.some((m) => m.modelName === dm))
              .map((dm) => (
                <ModelOptionCard
                  key={dm}
                  modelName={dm}
                  displayName={dm}
                  description={t('hardwareWizard.customLocalModel')}
                  isInstalled={true}
                  isSelected={selectedTranslation === dm}
                  onSelect={() => onSelectTranslation(dm)}
                  accentColor="sky"
                />
              ))}
          </div>
        </div>
      )}

      {/* Medical & Clinical Model */}
      {subTab === 'medical' && (
        <div className="space-y-2.5 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
          <div className="flex items-center justify-between text-rose-300">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-rose-400" />
              <h4 className="text-xs font-bold uppercase tracking-wider">{t('hardwareWizard.medicalModelTitle')}</h4>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              Selezionato: <strong className="text-rose-300">{selectedMedical || 'Nessuno (Opzionale)'}</strong>
            </span>
          </div>
          <p className="text-[11px] text-slate-400">{t('hardwareWizard.medicalModelDesc')} <span className="text-rose-400/80 font-medium">({t('hardwareWizard.optionalDomainModel')})</span></p>

          <div className="space-y-1.5" role="radiogroup" aria-label={t('hardwareWizard.medicalModelTitle')}>
            {/* Optional Unset Card */}
            <div
              onClick={() => onSelectMedical?.('')}
              className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between focus-ring active:scale-[0.99] ${
                !selectedMedical
                  ? 'bg-rose-950/40 border-rose-500/60 text-rose-200 shadow-sm ring-1 ring-rose-500/30'
                  : 'bg-slate-900/40 border-slate-800 text-slate-400 hover:border-slate-700 hover:bg-slate-900/70'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <XCircle className="w-4 h-4 text-slate-400" />
                <div>
                  <span className="text-xs font-bold block">Nessun Modello Medico Dedicato</span>
                  <span className="text-[10px] text-slate-400">Usa il modello Chat RAG standard per le query mediche</span>
                </div>
              </div>
              {!selectedMedical && <span className="text-[10px] font-bold text-rose-400">Predefinito</span>}
            </div>

            {medicalTierModels.map((m) => (
              <ModelOptionCard
                key={m.modelName}
                modelName={m.modelName}
                displayName={m.displayName}
                description={m.description}
                sizeBytesApprox={m.sizeBytesApprox}
                family={m.family}
                isRecommended={m.isRecommended}
                isInstalled={isModelDownloaded(m.modelName)}
                isSelected={selectedMedical === m.modelName}
                onSelect={() => onSelectMedical?.(m.modelName)}
                accentColor="rose"

                compatibilityStatus={m.compatibilityStatus}
                compatibilityWarning={m.compatibilityWarning}
              />
            ))}

            {downloadedModels
              .filter((dm) => !medicalTierModels.some((m) => m.modelName === dm) && (dm.includes('med') || dm.includes('bio')))
              .map((dm) => (
                <ModelOptionCard
                  key={dm}
                  modelName={dm}
                  displayName={dm}
                  description={t('hardwareWizard.customLocalModel')}
                  isInstalled={true}
                  isSelected={selectedMedical === dm}
                  onSelect={() => onSelectMedical?.(dm)}
                  accentColor="rose"
                />
              ))}
          </div>
        </div>
      )}

      {/* Legal & Compliance Model */}
      {subTab === 'legal' && (
        <div className="space-y-2.5 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
          <div className="flex items-center justify-between text-amber-300">
            <div className="flex items-center gap-2">
              <Scale className="w-4 h-4 text-amber-400" />
              <h4 className="text-xs font-bold uppercase tracking-wider">{t('hardwareWizard.legalModelTitle')}</h4>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              Selezionato: <strong className="text-amber-300">{selectedLegal || 'Nessuno (Opzionale)'}</strong>
            </span>
          </div>
          <p className="text-[11px] text-slate-400">{t('hardwareWizard.legalModelDesc')} <span className="text-amber-400/80 font-medium">({t('hardwareWizard.optionalDomainModel')})</span></p>

          <div className="space-y-1.5" role="radiogroup" aria-label={t('hardwareWizard.legalModelTitle')}>
            {/* Optional Unset Card */}
            <div
              onClick={() => onSelectLegal?.('')}
              className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between focus-ring active:scale-[0.99] ${
                !selectedLegal
                  ? 'bg-amber-950/40 border-amber-500/60 text-amber-200 shadow-sm ring-1 ring-amber-500/30'
                  : 'bg-slate-900/40 border-slate-800 text-slate-400 hover:border-slate-700 hover:bg-slate-900/70'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <XCircle className="w-4 h-4 text-slate-400" />
                <div>
                  <span className="text-xs font-bold block">Nessun Modello Legale Dedicato</span>
                  <span className="text-[10px] text-slate-400">Usa il modello Chat RAG standard per le clausole e contratti</span>
                </div>
              </div>
              {!selectedLegal && <span className="text-[10px] font-bold text-amber-400">Predefinito</span>}
            </div>

            {legalTierModels.map((m) => (
              <ModelOptionCard
                key={m.modelName}
                modelName={m.modelName}
                displayName={m.displayName}
                description={m.description}
                sizeBytesApprox={m.sizeBytesApprox}
                family={m.family}
                isRecommended={m.isRecommended}
                isInstalled={isModelDownloaded(m.modelName)}
                isSelected={selectedLegal === m.modelName}
                onSelect={() => onSelectLegal?.(m.modelName)}
                accentColor="amber"

                compatibilityStatus={m.compatibilityStatus}
                compatibilityWarning={m.compatibilityWarning}
              />
            ))}

            {downloadedModels
              .filter((dm) => !legalTierModels.some((m) => m.modelName === dm) && (dm.includes('law') || dm.includes('legal') || dm.includes('saul') || dm.includes('command')))
              .map((dm) => (
                <ModelOptionCard
                  key={dm}
                  modelName={dm}
                  displayName={dm}
                  description={t('hardwareWizard.customLocalModel')}
                  isInstalled={true}
                  isSelected={selectedLegal === dm}
                  onSelect={() => onSelectLegal?.(dm)}
                  accentColor="amber"
                />
              ))}
          </div>
        </div>
      )}

    </div>
  )
}
