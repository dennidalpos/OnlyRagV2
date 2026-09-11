import React from 'react'
import {
  Code,
  MessageSquare,
  Eye,
  Activity,
  Sparkles,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { isOllamaModelInstalled } from '../../services/hardwareRecommendationEngine'
import type { ModelFitVerdict } from '../../services/hardwareRecommendationEngine'
import type {
  HardwareWizardModelOptions,
  HardwareWizardModelSuite,
} from '../../../shared/domain/hardware/hardwareModelCatalog'
import { buildOllamaModelOptions } from '../../services/ollamaModelOptions'
import { ModelSelect } from '../settings/ModelSelect'

export interface WizardStepRecommendedModelsProps {
  downloadedModels: string[]
  /** Per-model VRAM verdict for the detected host, rendered inline on every option. */
  getModelFit: (modelName: string) => ModelFitVerdict
  recommendedModels: HardwareWizardModelSuite
  modelOptions: HardwareWizardModelOptions
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
  recommendedModels,
  modelOptions,
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

  const isModelInstalled = (name: string) => isOllamaModelInstalled(name, downloadedModels)

  const buildOptions = (currentValue: string | undefined, catalog: string[], recommendation: string) => {
    return buildOllamaModelOptions(
      [...catalog, ...downloadedModels],
      currentValue,
      [recommendation]
    )
  }

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
    const installed = isModelInstalled(name)
    const state = installed ? `✓ ${name} [${t('common.ready')}]` : `⬇ ${name} [${t('common.download')}]`
    return (
      <option key={name} value={name}>
        {`${state}${renderVramBadge(name)}`}
      </option>
    )
  }

  return (
    <div className="space-y-4 max-h-[58vh] overflow-y-auto pr-1 custom-scrollbar">
      {/* Intro Banner */}
      <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-500/30 flex items-center gap-2.5 text-xs text-cyan-200">
        <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
        <span>
          Configurazione della suite di modelli funzionali raccomandati per il tuo profilo hardware. Ciascun modello lavora in modo dedicato senza swapping continuo di memoria.
        </span>
      </div>

      {/* 1. AI Coding Agent Studio */}
      <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-100 border-b border-slate-800/80 pb-2">
          <Code className="w-4 h-4 text-cyan-400" />
          <span>1. AI Coding Agent Studio (Sviluppo Software)</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Workhorse Coding Model */}
          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-cyan-300">Modello di Sviluppo Principale</span>
              <span className="text-[10px] text-cyan-400 font-mono">Workhorse</span>
            </div>
            <ModelSelect
              ariaLabel="Seleziona Modello Coding Principale"
              value={selectedCoding}
              onChange={(e) => onChangeCoding(e.target.value)}
            >
              {buildOptions(selectedCoding, modelOptions.coding, recommendedModels.coding).map((m) => renderOption(m))}
            </ModelSelect>
          </div>

        </div>
      </div>

      {/* 2. RAG Chat & Document Translation */}
      <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-100 border-b border-slate-800/80 pb-2">
          <MessageSquare className="w-4 h-4 text-purple-400" />
          <span>2. RAG Chat &amp; Traduzione Documenti</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Chat Model */}
          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-purple-300">Modello RAG Chat</span>
              <span className="text-[10px] text-purple-400 font-mono">Conversazione</span>
            </div>
            <ModelSelect
              ariaLabel="Seleziona Modello RAG Chat"
              value={selectedChat}
              onChange={(e) => onChangeChat(e.target.value)}
            >
              {buildOptions(selectedChat, modelOptions.chat, recommendedModels.chat).map((m) => renderOption(m))}
            </ModelSelect>
          </div>

          {/* Translation Model */}
          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-sky-300">Modello Traduzione</span>
              <span className="text-[10px] text-sky-400 font-mono">Localizzazione</span>
            </div>
            <ModelSelect
              ariaLabel="Seleziona Modello Traduzione"
              value={selectedTranslation}
              onChange={(e) => onChangeTranslation(e.target.value)}
            >
              {buildOptions(selectedTranslation, modelOptions.translation, recommendedModels.translation).map((m) => renderOption(m))}
            </ModelSelect>
          </div>
        </div>
      </div>

      {/* 3. Ingestion, Vision OCR & Vector Embedding */}
      <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-100 border-b border-slate-800/80 pb-2">
          <Eye className="w-4 h-4 text-amber-400" />
          <span>3. Visione &amp; Ricerca Vettoriale</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Vision Model */}
          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-amber-300">Vision &amp; OCR Multimodale</span>
              <span className="text-[10px] text-amber-400 font-mono">Immagini / PDF</span>
            </div>
            <ModelSelect
              ariaLabel="Seleziona Modello Visione"
              value={selectedVision}
              onChange={(e) => onChangeVision(e.target.value)}
            >
              {buildOptions(selectedVision, modelOptions.vision, recommendedModels.vision).map((m) => renderOption(m))}
            </ModelSelect>
          </div>

          {/* Embedding Model */}
          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-purple-300">Embedding Vettoriale (LanceDB)</span>
              <span className="text-[10px] text-purple-400 font-mono">Semantica</span>
            </div>
            <ModelSelect
              ariaLabel="Seleziona Modello Embedding"
              value={selectedEmbedding}
              onChange={(e) => onChangeEmbedding(e.target.value)}
            >
              {buildOptions(selectedEmbedding, modelOptions.embedding, recommendedModels.embedding).map((m) => renderOption(m))}
            </ModelSelect>
          </div>
        </div>
      </div>

      {/* 4. Specialized Vertical Domains (Medical & Legal) */}
      <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-100 border-b border-slate-800/80 pb-2">
          <Activity className="w-4 h-4 text-rose-400" />
          <span>4. Domini Specialistici (Opzionale)</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Medical Model */}
          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-rose-300">Dominio Medico / Clinico</span>
              <span className="text-[10px] text-rose-400 font-mono">Healthcare</span>
            </div>
            <ModelSelect
              ariaLabel="Seleziona Modello Medico"
              value={selectedMedical || ''}
              onChange={(e) => onChangeMedical(e.target.value || undefined)}
            >
              <option value="">(Usa Modello RAG Chat)</option>
              {buildOptions(selectedMedical, modelOptions.medical, '').map((m) => renderOption(m))}
            </ModelSelect>
          </div>

          {/* Legal Model */}
          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-amber-300">Dominio Legale / Giuridico</span>
              <span className="text-[10px] text-amber-400 font-mono">Normativa</span>
            </div>
            <ModelSelect
              ariaLabel="Seleziona Modello Legale"
              value={selectedLegal || ''}
              onChange={(e) => onChangeLegal(e.target.value || undefined)}
            >
              <option value="">(Usa Modello RAG Chat)</option>
              {buildOptions(selectedLegal, modelOptions.legal, '').map((m) => renderOption(m))}
            </ModelSelect>
          </div>
        </div>
      </div>
    </div>
  )
}
