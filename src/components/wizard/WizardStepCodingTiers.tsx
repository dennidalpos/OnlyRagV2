import React, { useState } from 'react'
import { Code } from 'lucide-react'
import { ModelRecommendation } from '../../services/hardwareRecommendationEngine'
import { ModelOptionCard } from './ModelOptionCard'
import { useTranslation } from '../../i18n'

export interface WizardStepCodingTiersProps {
  useComplexityRouting: boolean
  onToggleComplexityRouting: (val: boolean) => void
  selectedFast: string
  onSelectFast: (m: string) => void
  selectedStandard: string
  onSelectStandard: (m: string) => void
  selectedDeep: string
  onSelectDeep: (m: string) => void
  /** Optional Heavy Escalation Tier model (14B+). Empty string = disabled. */
  selectedHeavy: string
  onSelectHeavy: (m: string) => void
  fastTierModels: ModelRecommendation[]
  standardTierModels: ModelRecommendation[]
  deepReasoningTierModels: ModelRecommendation[]
  heavyEscalationTierModels: ModelRecommendation[]
  downloadedModels: string[]
  isModelDownloaded: (name: string) => boolean
}

export const WizardStepCodingTiers: React.FC<WizardStepCodingTiersProps> = ({
  useComplexityRouting,
  onToggleComplexityRouting,
  selectedFast,
  onSelectFast,
  selectedStandard,
  onSelectStandard,
  selectedDeep,
  onSelectDeep,
  selectedHeavy,
  onSelectHeavy,
  fastTierModels,
  standardTierModels,
  deepReasoningTierModels,
  heavyEscalationTierModels,
  downloadedModels,
  isModelDownloaded,
}) => {
  const { t } = useTranslation()
  const [subTab, setSubTab] = useState<'standard' | 'fast' | 'deep' | 'heavy'>('standard')

  const allPresetModels = [
    ...fastTierModels,
    ...standardTierModels,
    ...deepReasoningTierModels,
    ...heavyEscalationTierModels,
  ]

  const extraLocalModels = downloadedModels.filter(
    (dm) => !allPresetModels.some((m) => m.modelName === dm)
  )

  return (
    <div className="space-y-4">
      {/* Header & Router Toggle */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div>
          <h3 className="text-xs font-bold text-slate-100 flex items-center gap-2 uppercase tracking-wider">
            <Code className="w-4 h-4 text-emerald-400" /> {t('settings.codingAgentSection')}
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {t('settings.codingAgentSubtitle')}
          </p>
        </div>

        <label className="flex items-center gap-2 text-xs font-semibold text-slate-300 cursor-pointer select-none bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
          <input
            type="checkbox"
            checked={useComplexityRouting}
            onChange={(e) => onToggleComplexityRouting(e.target.checked)}
            className="rounded bg-slate-900 border-slate-700 text-emerald-500 focus:ring-emerald-500/20"
          />
          <span className={useComplexityRouting ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
            {useComplexityRouting ? t('settings.complexityRouterActive') : t('settings.complexityRouterDisabled')}
          </span>
        </label>
      </div>

      {/* Sub-tier navigation — 4 tabs when complexity routing is active */}
      <div className={`grid gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800 ${useComplexityRouting ? 'grid-cols-4' : 'grid-cols-3'}`}>
        <button
          type="button"
          onClick={() => setSubTab('fast')}
          className={`py-1.5 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
            subTab === 'fast'
              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/50 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>🟢 {t('settings.fastTier')}</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('standard')}
          className={`py-1.5 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
            subTab === 'standard'
              ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-500/50 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>🔵 {t('settings.standardTier')}</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('deep')}
          className={`py-1.5 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
            subTab === 'deep'
              ? 'bg-purple-950/80 text-purple-300 border border-purple-500/50 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>🟣 {t('settings.deepTier')}</span>
        </button>

        {useComplexityRouting && (
          <button
            type="button"
            onClick={() => setSubTab('heavy')}
            className={`py-1.5 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              subTab === 'heavy'
                ? 'bg-amber-950/80 text-amber-300 border border-amber-500/50 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>{t('hardwareWizard.heavyTierBadge')}</span>
          </button>
        )}
      </div>

      {/* Sub-tier Content: Fast */}
      {subTab === 'fast' && (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-400">{t('hardwareWizard.step2Desc')}</p>
          <div className="space-y-1.5" role="radiogroup" aria-label={t('hardwareWizard.step2Title')}>
            {fastTierModels.map((m) => (
              <ModelOptionCard
                key={m.modelName}
                modelName={m.modelName}
                displayName={m.displayName}
                description={m.description}
                sizeBytesApprox={m.sizeBytesApprox}
                family={m.family}
                isRecommended={m.isRecommended}
                isInstalled={isModelDownloaded(m.modelName)}
                isSelected={selectedFast === m.modelName}
                onSelect={() => onSelectFast(m.modelName)}
                accentColor="emerald"
                compatibilityStatus={m.compatibilityStatus}
                compatibilityWarning={m.compatibilityWarning}
              />
            ))}
          </div>
        </div>
      )}

      {/* Sub-tier Content: Standard */}
      {subTab === 'standard' && (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-400">{t('hardwareWizard.step3Desc')}</p>
          <div className="space-y-1.5" role="radiogroup" aria-label={t('hardwareWizard.step3Title')}>
            {standardTierModels.map((m) => (
              <ModelOptionCard
                key={m.modelName}
                modelName={m.modelName}
                displayName={m.displayName}
                description={m.description}
                sizeBytesApprox={m.sizeBytesApprox}
                family={m.family}
                isRecommended={m.isRecommended}
                isInstalled={isModelDownloaded(m.modelName)}
                isSelected={selectedStandard === m.modelName}
                onSelect={() => onSelectStandard(m.modelName)}
                accentColor="cyan"
                compatibilityStatus={m.compatibilityStatus}
                compatibilityWarning={m.compatibilityWarning}
              />
            ))}
          </div>
        </div>
      )}

      {/* Sub-tier Content: Deep Reasoning */}
      {subTab === 'deep' && (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-400">{t('hardwareWizard.step4Desc')}</p>
          <div className="space-y-1.5" role="radiogroup" aria-label={t('hardwareWizard.step4Title')}>
            {deepReasoningTierModels.map((m) => (
              <ModelOptionCard
                key={m.modelName}
                modelName={m.modelName}
                displayName={m.displayName}
                description={m.description}
                sizeBytesApprox={m.sizeBytesApprox}
                family={m.family}
                isRecommended={m.isRecommended}
                isInstalled={isModelDownloaded(m.modelName)}
                isSelected={selectedDeep === m.modelName}
                onSelect={() => onSelectDeep(m.modelName)}
                accentColor="purple"
                compatibilityStatus={m.compatibilityStatus}
                compatibilityWarning={m.compatibilityWarning}
              />
            ))}
          </div>
        </div>
      )}

      {/* Sub-tier Content: Heavy Escalation ⚡ */}
      {subTab === 'heavy' && useComplexityRouting && (
        <div className="space-y-2">
          <div className="p-2.5 rounded-xl bg-amber-950/20 border border-amber-800/40 space-y-0.5">
            <p className="text-[11px] font-semibold text-amber-300">
              {t('hardwareWizard.heavyEscalationSectionTitle')}
            </p>
            <p className="text-[11px] text-slate-400">
              {t('hardwareWizard.heavyEscalationSectionDescPre')} <strong className="text-amber-400">12GB+ VRAM</strong>. {t('hardwareWizard.heavyEscalationSectionDescPost')}
            </p>
          </div>

          {/* Disable option */}
          <div
            role="radio"
            aria-checked={selectedHeavy === ''}
            tabIndex={selectedHeavy === '' ? 0 : -1}
            onClick={() => onSelectHeavy('')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectHeavy('') } }}
            className={`p-3 rounded-xl border cursor-pointer flex items-center gap-3 transition-all focus-ring active:scale-[0.99] ${
              selectedHeavy === ''
                ? 'bg-slate-900/80 border-slate-600 shadow-sm ring-1 ring-slate-500/20'
                : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-all ${
              selectedHeavy === '' ? 'border-slate-400 bg-slate-500' : 'border-slate-600 bg-slate-950'
            }`}>
              {selectedHeavy === '' && <span className="w-2 h-2 rounded-full bg-slate-200 block" />}
            </div>
            <div>
              <span className="font-semibold text-slate-400 text-xs">{t('hardwareWizard.heavyDisabledLabel')}</span>
              <p className="text-[11px] text-slate-400 mt-0.5">{t('hardwareWizard.heavyDisabledDesc')}</p>
            </div>
          </div>

          {/* Heavy model list */}
          <div className="space-y-1.5" role="radiogroup" aria-label="Heavy Escalation Tier model selection">
            {heavyEscalationTierModels.map((m) => (
              <ModelOptionCard
                key={m.modelName}
                modelName={m.modelName}
                displayName={m.displayName}
                description={m.description}
                sizeBytesApprox={m.sizeBytesApprox}
                family={m.family}
                isRecommended={m.isRecommended}
                isInstalled={isModelDownloaded(m.modelName)}
                isSelected={selectedHeavy === m.modelName}
                onSelect={() => onSelectHeavy(m.modelName)}
                accentColor="amber"
                compatibilityStatus={m.compatibilityStatus}
                compatibilityWarning={m.compatibilityWarning}
              />
            ))}
          </div>
        </div>
      )}

      {/* Extra Installed Local Models Selection */}
      {extraLocalModels.length > 0 && (
        <div className="pt-2 border-t border-slate-800 space-y-1.5">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            {t('hardwareWizard.localInstalledBadge')}:
          </span>
          <div className="space-y-1.5">
            {extraLocalModels.map((dm) => {
              const currentVal =
                subTab === 'fast'
                  ? selectedFast
                  : subTab === 'standard'
                  ? selectedStandard
                  : subTab === 'heavy'
                  ? selectedHeavy
                  : selectedDeep
              const isSelected = currentVal === dm
              const accentForTab =
                subTab === 'fast'
                  ? 'emerald'
                  : subTab === 'standard'
                  ? 'cyan'
                  : subTab === 'heavy'
                  ? 'amber'
                  : 'purple'
              return (
                <ModelOptionCard
                  key={dm}
                  modelName={dm}
                  displayName={dm}
                  description={t('hardwareWizard.customLocalModel')}
                  isInstalled={true}
                  isSelected={isSelected}
                  onSelect={() => {
                    if (subTab === 'fast') onSelectFast(dm)
                    else if (subTab === 'standard') onSelectStandard(dm)
                    else if (subTab === 'heavy') onSelectHeavy(dm)
                    else onSelectDeep(dm)
                  }}
                  accentColor={accentForTab as 'emerald' | 'cyan' | 'purple' | 'amber'}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
