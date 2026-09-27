import React from 'react'
import { Code, MessageSquare, Eye, Activity, Sparkles } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { findInstalledOllamaOption } from '../../services/ollamaModelOptions'
import type { ModelFitVerdict } from '../../services/hardwareRecommendationEngine'
import { ModelSelect } from '../settings/ModelSelect'

export interface WizardStepRecommendedModelsProps {
  downloadedModels: string[]
  /** Per-model VRAM verdict for the detected host, rendered inline on every option. */
  getModelFit: (modelName: string) => ModelFitVerdict
  // Coding
  selectedCoding: string
  onChangeCoding: (model: string) => void
  // Chat
  selectedChat: string
  onChangeChat: (model: string) => void
  // Translation
  selectedTranslation: string
  onChangeTranslation: (model: string) => void
  // Vision & OCR
  selectedVision: string
  onChangeVision: (model: string) => void
  // Embedding
  selectedEmbedding: string
  onChangeEmbedding: (model: string) => void
  // Specialized Domains
  selectedMedical?: string
  onChangeMedical: (model?: string) => void
  selectedLegal?: string
  onChangeLegal: (model?: string) => void
}

export const WizardStepRecommendedModels: React.FC<WizardStepRecommendedModelsProps> = ({
  downloadedModels,
  getModelFit,
  selectedCoding,
  onChangeCoding,
  selectedChat,
  onChangeChat,
  selectedTranslation,
  onChangeTranslation,
  selectedVision,
  onChangeVision,
  selectedEmbedding,
  onChangeEmbedding,
  selectedMedical,
  onChangeMedical,
  selectedLegal,
  onChangeLegal,
}) => {
  const { t } = useTranslation()

  const installedOption = (name: string) => findInstalledOllamaOption(downloadedModels, name)

  const buildOptions = () => [...new Set(downloadedModels)]
  const unavailable = (name: string | undefined) => (name && !installedOption(name) ? name : undefined)

  // A native <option> renders text only, so the VRAM verdict is appended to the label rather
  // than drawn as a styled badge.
  const FIT_MARKERS: Record<ModelFitVerdict['compatibilityStatus'], string> = {
    optimal_vram: '●',
    tight_vram: '⚠',
    exceeds_vram: '⛔',
  }
  const FIT_LABEL_KEYS = {
    optimal_vram: 'hardwareWizard.vramFitOptimal',
    tight_vram: 'hardwareWizard.vramFitTight',
    exceeds_vram: 'hardwareWizard.vramFitExceeds',
  } as const

  const renderVramBadge = (name: string) => {
    const { compatibilityStatus, footprintGB } = getModelFit(name)
    return ` — ${FIT_MARKERS[compatibilityStatus]} ${footprintGB} GB · ${t(FIT_LABEL_KEYS[compatibilityStatus])}`
  }

  const renderOption = (name: string) => {
    return (
      <option key={name} value={name}>
        {`✓ ${name} [${t('common.ready')}]${renderVramBadge(name)}`}
      </option>
    )
  }

  return (
    <div className="space-y-4 max-h-[58vh] overflow-y-auto pr-1 custom-scrollbar">
      {/* Intro Banner */}
      <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-500/30 flex items-center gap-2.5 text-xs text-cyan-200">
        <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
        <span>{t('wizardModels.intro')}</span>
      </div>

      {/* 1. AI Coding Agent Studio */}
      <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-100 border-b border-slate-800/80 pb-2">
          <Code className="w-4 h-4 text-cyan-400" />
          <span>{t('wizardModels.sectionCoding')}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Workhorse Coding Model */}
          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-cyan-300">{t('wizardModels.codingModel')}</span>
              <span className="text-[10px] text-cyan-400 font-mono">Workhorse</span>
            </div>
            <ModelSelect
              ariaLabel={t('wizardModels.selectCoding')}
              value={installedOption(selectedCoding) || selectedCoding}
              unavailableModel={unavailable(selectedCoding)}
              unavailableLabel={t('uiShell.modelNotInstalled')}
              onChange={(e) => onChangeCoding(e.target.value)}
            >
              <option value="">{t('uiShell.selectLocalModel')}</option>
              {buildOptions().map((m) => renderOption(m))}
            </ModelSelect>
          </div>
        </div>
      </div>

      {/* 2. RAG Chat & Document Translation */}
      <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-100 border-b border-slate-800/80 pb-2">
          <MessageSquare className="w-4 h-4 text-purple-400" />
          <span>{t('wizardModels.sectionChat')}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Chat Model */}
          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-purple-300">{t('wizardModels.chatModel')}</span>
              <span className="text-[10px] text-purple-400 font-mono">{t('wizardModels.chatTag')}</span>
            </div>
            <ModelSelect
              ariaLabel={t('wizardModels.selectChat')}
              value={installedOption(selectedChat) || selectedChat}
              unavailableModel={unavailable(selectedChat)}
              unavailableLabel={t('uiShell.modelNotInstalled')}
              onChange={(e) => onChangeChat(e.target.value)}
            >
              <option value="">{t('uiShell.selectLocalModel')}</option>
              {buildOptions().map((m) => renderOption(m))}
            </ModelSelect>
          </div>

          {/* Translation Model */}
          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-sky-300">{t('wizardModels.translationModel')}</span>
              <span className="text-[10px] text-sky-400 font-mono">{t('wizardModels.translationTag')}</span>
            </div>
            <ModelSelect
              ariaLabel={t('wizardModels.selectTranslation')}
              value={installedOption(selectedTranslation) || selectedTranslation}
              unavailableModel={unavailable(selectedTranslation)}
              unavailableLabel={t('uiShell.modelNotInstalled')}
              onChange={(e) => onChangeTranslation(e.target.value)}
            >
              <option value="">{t('uiShell.selectLocalModel')}</option>
              {buildOptions().map((m) => renderOption(m))}
            </ModelSelect>
          </div>
        </div>
      </div>

      {/* 3. Ingestion, Vision OCR & Vector Embedding */}
      <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-100 border-b border-slate-800/80 pb-2">
          <Eye className="w-4 h-4 text-amber-400" />
          <span>{t('wizardModels.sectionVision')}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Vision Model */}
          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-amber-300">{t('wizardModels.visionModel')}</span>
              <span className="text-[10px] text-amber-400 font-mono">{t('wizardModels.visionTag')}</span>
            </div>
            <ModelSelect
              ariaLabel={t('wizardModels.selectVision')}
              value={installedOption(selectedVision) || selectedVision}
              unavailableModel={unavailable(selectedVision)}
              unavailableLabel={t('uiShell.modelNotInstalled')}
              onChange={(e) => onChangeVision(e.target.value)}
            >
              <option value="">{t('uiShell.selectLocalModel')}</option>
              {buildOptions().map((m) => renderOption(m))}
            </ModelSelect>
          </div>

          {/* Embedding Model */}
          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-purple-300">{t('wizardModels.embeddingModel')}</span>
              <span className="text-[10px] text-purple-400 font-mono">{t('wizardModels.embeddingTag')}</span>
            </div>
            <ModelSelect
              ariaLabel={t('wizardModels.selectEmbedding')}
              value={installedOption(selectedEmbedding) || selectedEmbedding}
              unavailableModel={unavailable(selectedEmbedding)}
              unavailableLabel={t('uiShell.modelNotInstalled')}
              onChange={(e) => onChangeEmbedding(e.target.value)}
            >
              <option value="">{t('uiShell.selectLocalModel')}</option>
              {buildOptions().map((m) => renderOption(m))}
            </ModelSelect>
          </div>
        </div>
      </div>

      {/* 4. Specialized Vertical Domains (Medical & Legal) */}
      <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-100 border-b border-slate-800/80 pb-2">
          <Activity className="w-4 h-4 text-rose-400" />
          <span>{t('wizardModels.sectionDomains')}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Medical Model */}
          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-rose-300">{t('wizardModels.medicalModel')}</span>
              <span className="text-[10px] text-rose-400 font-mono">Healthcare</span>
            </div>
            <ModelSelect
              ariaLabel={t('wizardModels.selectMedical')}
              value={installedOption(selectedMedical || '') || selectedMedical || ''}
              unavailableModel={unavailable(selectedMedical)}
              unavailableLabel={t('uiShell.modelNotInstalled')}
              onChange={(e) => onChangeMedical(e.target.value || undefined)}
            >
              <option value="">{t('wizardModels.useChatModel')}</option>
              {buildOptions().map((m) => renderOption(m))}
            </ModelSelect>
          </div>

          {/* Legal Model */}
          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-amber-300">{t('wizardModels.legalModel')}</span>
              <span className="text-[10px] text-amber-400 font-mono">{t('wizardModels.legalTag')}</span>
            </div>
            <ModelSelect
              ariaLabel={t('wizardModels.selectLegal')}
              value={installedOption(selectedLegal || '') || selectedLegal || ''}
              unavailableModel={unavailable(selectedLegal)}
              unavailableLabel={t('uiShell.modelNotInstalled')}
              onChange={(e) => onChangeLegal(e.target.value || undefined)}
            >
              <option value="">{t('wizardModels.useChatModel')}</option>
              {buildOptions().map((m) => renderOption(m))}
            </ModelSelect>
          </div>
        </div>
      </div>
    </div>
  )
}
