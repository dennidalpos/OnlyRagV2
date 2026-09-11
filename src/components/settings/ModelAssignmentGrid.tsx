import React from 'react'
import {
  Code,
  MessageSquare,
  Languages,
  FileText,
  Database,
  Eye,
  Activity,
  Scale,
} from 'lucide-react'
import { DiagnosticsData, AppSettings } from '../../types'
import { useTranslation } from '../../i18n'
import { isOllamaModelInstalled } from '../../services/hardwareRecommendationEngine'
import { resolveVerificationStatus } from '../../services/codingModelMatrix'
import {
  buildHardwareWizardModelOptions,
  CODING_CATALOG_MODEL_NAMES,
} from '../../../shared/domain/hardware/hardwareModelCatalog'
import { useOllamaModelMetrics } from '../../hooks/useOllamaModelMetrics'
import { extractHardwareFacts } from '../../services/hardwareRecommendationEngine'
import { buildOllamaModelOptions } from '../../services/ollamaModelOptions'
import { resolveMaxContextTokens } from '../../../shared/domain/hardware/hardwareProfileTiers'
import { ModelBadgeStrip } from './ModelBadgeStrip'
import { ModelContextControl } from './ModelContextControl'
import { ModelSelect } from './ModelSelect'

const CATALOG_MODELS = Object.values(buildHardwareWizardModelOptions()).flat()

interface ModelAssignmentGridProps {
  diagnostics: DiagnosticsData | null
  settings: AppSettings
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void
}

export const ModelAssignmentGrid: React.FC<ModelAssignmentGridProps> = ({
  diagnostics,
  settings,
  onUpdateSettings,
}) => {
  const { t } = useTranslation()
  const models = diagnostics?.ollama.models || []
  const { metrics } = useOllamaModelMetrics(settings.ollamaHost)
  const hardwareDefault = resolveMaxContextTokens('Auto', extractHardwareFacts(diagnostics))
  const codingModel = settings.codingModel || settings.defaultModel || ''
  const chatModel = settings.chatModel || ''
  const translationModel = settings.translationModel || ''
  const visionModel = settings.visionModel || ''
  const embeddingModel = settings.embeddingModel || ''
  const modelPool = [...CATALOG_MODELS, ...models]

  const isModelInstalled = (name: string) => isOllamaModelInstalled(name, models)

  const renderBadges = (modelName: string) => {
    if (!modelName) return null
    const status = resolveVerificationStatus({
      modelName,
      isCatalogued: CODING_CATALOG_MODEL_NAMES.has(modelName),
      capabilities: metrics[modelName]?.capabilities,
    })
    return <ModelBadgeStrip modelName={modelName} status={status} metrics={metrics[modelName]} className="pt-0.5" />
  }

  const buildModelOptions = (currentValue: string) => {
    return buildOllamaModelOptions(modelPool, currentValue)
  }

  const renderOption = (name: string, label: string) => {
    const installed = isModelInstalled(name)
    return (
      <option key={name} value={name}>
        {installed ? `✓ ${label} [${t('common.ready')}]` : `⬇ ${label} [${t('common.download')}]`}
      </option>
    )
  }

  const renderEmptyOption = () => (
    <option value="" disabled>
      {models.length > 0 ? '-- Seleziona un modello locale --' : '-- Nessun modello disponibile in Ollama --'}
    </option>
  )

  return (
    <div className="space-y-5">
      {/* Module 1: AI Coding Agent Studio */}
      <div className="glass-panel rounded-xl p-5 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
              <Code className="w-4.5 h-4.5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                1. AI Coding Agent Studio
              </h2>
              <p className="text-[11px] text-slate-400">
                Configurazione del modello di sviluppo principale.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Workhorse Coding Model */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                <Code className="w-4 h-4 text-cyan-400" /> Modello di Sviluppo Principale (Workhorse)
              </span>
              <span className="text-[10px] text-cyan-400 font-mono font-bold">Primario</span>
            </div>
            <ModelSelect
              ariaLabel="Seleziona Modello Coding Principale"
              value={codingModel}
              onChange={(e) => {
                onUpdateSettings({
                  codingModel: e.target.value,
                })
              }}
            >
              {renderEmptyOption()}
              {buildModelOptions(codingModel).map((m) => renderOption(m, m))}
            </ModelSelect>
            {renderBadges(codingModel)}
            {codingModel && (
              <ModelContextControl
                model={codingModel}
                settings={settings}
                metrics={metrics[codingModel]}
                hardwareDefault={hardwareDefault}
                onUpdateSettings={onUpdateSettings}
              />
            )}
            <p className="text-[10px] text-slate-400 leading-tight">
              Esegue i tool, scrive codice e mantiene la KV-cache fissa in GPU a zero latenza.
            </p>
          </div>

        </div>
      </div>

      {/* Module 2: RAG Chat & Document Translation */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* RAG & Chat */}
        <div className="glass-panel rounded-xl p-5 border border-slate-800 space-y-3">
          <div className="flex items-center gap-3 border-b border-slate-800/80 pb-2.5">
            <div className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center">
              <MessageSquare className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100">{t('settings.ragChatSection')}</h2>
              <p className="text-[11px] text-slate-400">{t('settings.ragChatSubtitle')}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-purple-300 block">{t('settings.chatModel')}:</label>
            <ModelSelect
              ariaLabel="Select RAG & Chat model"
              value={chatModel}
              onChange={(e) => onUpdateSettings({ chatModel: e.target.value })}
            >
              {renderEmptyOption()}
              {buildModelOptions(chatModel).map((m) => renderOption(m, m))}
            </ModelSelect>
            {chatModel && (
              <ModelContextControl
                model={chatModel}
                settings={settings}
                metrics={metrics[chatModel]}
                hardwareDefault={hardwareDefault}
                onUpdateSettings={onUpdateSettings}
              />
            )}
          </div>

        </div>

        {/* Doc Translation */}
        <div className="glass-panel rounded-xl p-5 border border-slate-800 space-y-3">
          <div className="flex items-center gap-3 border-b border-slate-800/80 pb-2.5">
            <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center">
              <Languages className="w-4 h-4 text-sky-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100">{t('settings.translationSection')}</h2>
              <p className="text-[11px] text-slate-400">{t('settings.translationSubtitle')}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-sky-300 block">{t('settings.translationModel')}:</label>
            <ModelSelect
              ariaLabel="Select Document Translation model"
              value={translationModel}
              onChange={(e) => onUpdateSettings({ translationModel: e.target.value })}
            >
              {renderEmptyOption()}
              {buildModelOptions(translationModel).map((m) => renderOption(m, m))}
            </ModelSelect>
            {translationModel && (
              <ModelContextControl
                model={translationModel}
                settings={settings}
                metrics={metrics[translationModel]}
                hardwareDefault={hardwareDefault}
                onUpdateSettings={onUpdateSettings}
              />
            )}
          </div>

        </div>
      </div>

      {/* Module 3: Ingestion, OCR & Vector Store */}
      <div className="glass-panel rounded-xl p-5 border border-slate-800 space-y-3">
        <div className="flex items-center gap-3 border-b border-slate-800/80 pb-2.5">
          <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
            <FileText className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100">{t('settings.ingestionOcrSection')}</h2>
            <p className="text-[11px] text-slate-400">{t('settings.ingestionOcrSubtitle')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Vision OCR */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-amber-300">
              <span className="flex items-center gap-1.5">
                <Eye className="w-4 h-4 text-amber-400" /> {t('settings.visionOcrLabel')}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Vision OCR</span>
            </div>
            <ModelSelect
              ariaLabel="Select Vision & OCR model"
              value={visionModel}
              onChange={(e) => onUpdateSettings({ visionModel: e.target.value })}
            >
              {renderEmptyOption()}
              {buildModelOptions(visionModel).map((m) => renderOption(m, m))}
            </ModelSelect>
            {visionModel && (
              <ModelContextControl
                model={visionModel}
                settings={settings}
                metrics={metrics[visionModel]}
                hardwareDefault={hardwareDefault}
                onUpdateSettings={onUpdateSettings}
              />
            )}
          </div>

          {/* Vector Embedding */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-purple-300">
              <span className="flex items-center gap-1.5">
                <Database className="w-4 h-4 text-purple-400" /> {t('settings.vectorStoreLabel')}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Embedding (768d / 1024d)</span>
            </div>
            <ModelSelect
              ariaLabel="Select Vector Store Embedding model"
              value={embeddingModel}
              onChange={(e) => onUpdateSettings({ embeddingModel: e.target.value })}
            >
              {renderEmptyOption()}
              {buildModelOptions(embeddingModel).map((m) => renderOption(m, m))}
            </ModelSelect>
          </div>
        </div>
      </div>

      {/* Module 4: Specialized Vertical Domains (Medical & Legal) */}
      <div className="glass-panel rounded-xl p-5 border border-slate-800 space-y-3">
        <div className="flex items-center gap-3 border-b border-slate-800/80 pb-2.5">
          <div className="w-8 h-8 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center">
            <Activity className="w-4 h-4 text-rose-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100">{t('settings.verticalDomainsSection')}</h2>
            <p className="text-[11px] text-slate-400">{t('settings.verticalDomainsSubtitle')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Medical & Healthcare */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-rose-300">
              <span className="flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-rose-400" /> {t('settings.medicalModel')}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Clinical &amp; Health</span>
            </div>
            <ModelSelect
              ariaLabel="Select Medical & Clinical model"
              value={settings.medicalModel || ''}
              onChange={(e) => onUpdateSettings({ medicalModel: e.target.value })}
            >
              <option value="">{`-- ${t('common.none')} (${t('settings.chatModel')}) --`}</option>
              {buildModelOptions(settings.medicalModel || '').map((m) => renderOption(m, m))}
            </ModelSelect>
          </div>

          {/* Legal & Compliance */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-amber-300">
              <span className="flex items-center gap-1.5">
                <Scale className="w-4 h-4 text-amber-400" /> {t('settings.legalModel')}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Legal &amp; Normative</span>
            </div>
            <ModelSelect
              ariaLabel="Select Legal & Compliance model"
              value={settings.legalModel || ''}
              onChange={(e) => onUpdateSettings({ legalModel: e.target.value })}
            >
              <option value="">{`-- ${t('common.none')} (${t('settings.chatModel')}) --`}</option>
              {buildModelOptions(settings.legalModel || '').map((m) => renderOption(m, m))}
            </ModelSelect>
          </div>
        </div>
      </div>
    </div>
  )
}
