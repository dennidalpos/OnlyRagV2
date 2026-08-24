import React from 'react'
import {
  Code,
  MessageSquare,
  Eye,
  Activity,
  ShieldAlert,
  Sparkles,
  BadgeCheck,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { isOllamaModelInstalled } from '../../services/hardwareRecommendationEngine'
import type { ModelFitVerdict } from '../../services/hardwareRecommendationEngine'
import {
  type ModelIntent,
  filterModelsByIntent,
} from '../../services/modelIntentClassifier'

export interface WizardStepRecommendedModelsProps {
  downloadedModels: string[]
  /** Per-model VRAM verdict for the detected host, rendered inline on every option. */
  getModelFit: (modelName: string) => ModelFitVerdict
  /**
   * The coding models this app has been RUN against that also fit the detected hardware tier,
   * verified ones first. Empty when nothing in the catalog fits, which is rendered as such —
   * see selectWizardCodingSet.
   */
  verifiedCodingSet: string[]
  /** Applies the set above: first entry as workhorse, second as OOM fallback. */
  onApplyVerifiedSet: () => void
  // Coding
  selectedCoding: string
  selectedCodingFallback?: string
  onChangeCoding: (model: string) => void
  onChangeCodingFallback: (model?: string) => void
  codingPresetOptions: string[]
  // Chat
  selectedChat: string
  selectedChatFallback?: string
  onChangeChat: (model: string) => void
  onChangeChatFallback: (model?: string) => void
  chatPresetOptions: string[]
  // Translation
  selectedTranslation: string
  selectedTranslationFallback?: string
  onChangeTranslation: (model: string) => void
  onChangeTranslationFallback: (model?: string) => void
  translationPresetOptions: string[]
  // Vision & OCR
  selectedVision: string
  onChangeVision: (model: string) => void
  visionPresetOptions: string[]
  // Embedding
  selectedEmbedding: string
  onChangeEmbedding: (model: string) => void
  embeddingPresetOptions: string[]
  // Specialized Domains
  selectedMedical?: string
  onChangeMedical: (model?: string) => void
  medicalPresetOptions: string[]
  selectedLegal?: string
  onChangeLegal: (model?: string) => void
  legalPresetOptions: string[]
}

export const WizardStepRecommendedModels: React.FC<WizardStepRecommendedModelsProps> = ({
  downloadedModels,
  getModelFit,
  verifiedCodingSet,
  onApplyVerifiedSet,
  selectedCoding,
  selectedCodingFallback,
  onChangeCoding,
  onChangeCodingFallback,
  codingPresetOptions,
  selectedChat,
  selectedChatFallback,
  onChangeChat,
  onChangeChatFallback,
  chatPresetOptions,
  selectedTranslation,
  selectedTranslationFallback,
  onChangeTranslation,
  onChangeTranslationFallback,
  translationPresetOptions,
  selectedVision,
  onChangeVision,
  visionPresetOptions,
  selectedEmbedding,
  onChangeEmbedding,
  embeddingPresetOptions,
  selectedMedical,
  onChangeMedical,
  medicalPresetOptions,
  selectedLegal,
  onChangeLegal,
  legalPresetOptions,
}) => {
  const { t } = useTranslation()

  const isModelInstalled = (name: string) => isOllamaModelInstalled(name, downloadedModels)

  const buildOptions = (currentValue: string | undefined, presets: string[], intent: ModelIntent) => {
    return filterModelsByIntent(downloadedModels, intent, {
      includeCurrent: currentValue,
      presetOptions: presets,
    })
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

        {/* One click for the whole coding slot. Placed above the selects because it is the
            answer for the user who has no basis to choose between twenty tags on first launch;
            the selects below stay fully available for anyone who does. */}
        {verifiedCodingSet.length > 0 ? (
          <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/25">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-300">
                <BadgeCheck className="w-3.5 h-3.5" />
                Set consigliato per il tuo hardware
              </div>
              <p className="text-[10px] text-slate-400 leading-tight mt-0.5 truncate">
                {verifiedCodingSet.slice(0, 2).join('  ·  ')}
              </p>
            </div>
            <button
              type="button"
              onClick={onApplyVerifiedSet}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 text-[11px] font-bold hover:bg-emerald-500/25 focus-ring"
            >
              Applica
            </button>
          </div>
        ) : (
          <div className="p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/25 text-[10px] text-amber-300 leading-tight">
            Nessun modello del catalogo rientra nel profilo hardware rilevato. Scegli manualmente qui sotto,
            tenendo conto dell'indicatore di VRAM su ogni opzione.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Workhorse Coding Model */}
          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-cyan-300">Modello di Sviluppo Principale</span>
              <span className="text-[10px] text-cyan-400 font-mono">Workhorse</span>
            </div>
            <select
              aria-label="Seleziona Modello Coding Principale"
              value={selectedCoding}
              onChange={(e) => onChangeCoding(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono font-semibold focus-ring"
            >
              {buildOptions(selectedCoding, codingPresetOptions, 'coding').map((m) => renderOption(m))}
            </select>
          </div>

          {/* Coding Fallback */}
          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-amber-900/40 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-amber-300 flex items-center gap-1">
                <ShieldAlert className="w-3 h-3 text-amber-400" /> Fallback Auto-Healing OOM
              </span>
              <span className="text-[10px] text-amber-400 font-mono">Sicurezza</span>
            </div>
            <select
              aria-label="Seleziona Modello Fallback Coding"
              value={selectedCodingFallback || ''}
              onChange={(e) => onChangeCodingFallback(e.target.value || undefined)}
              className="w-full bg-slate-950 border border-amber-900/40 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono focus-ring"
            >
              <option value="">(Disattivato — Riprova sullo stesso)</option>
              {buildOptions(selectedCodingFallback, codingPresetOptions, 'coding')
                .filter((m) => m !== selectedCoding)
                .map((m) => renderOption(m))}
            </select>
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
            <select
              aria-label="Seleziona Modello RAG Chat"
              value={selectedChat}
              onChange={(e) => onChangeChat(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono font-semibold focus-ring"
            >
              {buildOptions(selectedChat, chatPresetOptions, 'chat').map((m) => renderOption(m))}
            </select>
          </div>

          {/* Translation Model */}
          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-sky-300">Modello Traduzione</span>
              <span className="text-[10px] text-sky-400 font-mono">Localizzazione</span>
            </div>
            <select
              aria-label="Seleziona Modello Traduzione"
              value={selectedTranslation}
              onChange={(e) => onChangeTranslation(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono font-semibold focus-ring"
            >
              {buildOptions(selectedTranslation, translationPresetOptions, 'translation').map((m) => renderOption(m))}
            </select>
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
            <select
              aria-label="Seleziona Modello Visione"
              value={selectedVision}
              onChange={(e) => onChangeVision(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono font-semibold focus-ring"
            >
              {buildOptions(selectedVision, visionPresetOptions, 'vision').map((m) => renderOption(m))}
            </select>
          </div>

          {/* Embedding Model */}
          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-purple-300">Embedding Vettoriale (LanceDB)</span>
              <span className="text-[10px] text-purple-400 font-mono">Semantica</span>
            </div>
            <select
              aria-label="Seleziona Modello Embedding"
              value={selectedEmbedding}
              onChange={(e) => onChangeEmbedding(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono font-semibold focus-ring"
            >
              {buildOptions(selectedEmbedding, embeddingPresetOptions, 'embedding').map((m) => renderOption(m))}
            </select>
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
            <select
              aria-label="Seleziona Modello Medico"
              value={selectedMedical || ''}
              onChange={(e) => onChangeMedical(e.target.value || undefined)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono focus-ring"
            >
              <option value="">(Usa Modello RAG Chat)</option>
              {buildOptions(selectedMedical, medicalPresetOptions, 'medical').map((m) => renderOption(m))}
            </select>
          </div>

          {/* Legal Model */}
          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-amber-300">Dominio Legale / Giuridico</span>
              <span className="text-[10px] text-amber-400 font-mono">Normativa</span>
            </div>
            <select
              aria-label="Seleziona Modello Legale"
              value={selectedLegal || ''}
              onChange={(e) => onChangeLegal(e.target.value || undefined)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono focus-ring"
            >
              <option value="">(Usa Modello RAG Chat)</option>
              {buildOptions(selectedLegal, legalPresetOptions, 'legal').map((m) => renderOption(m))}
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}
