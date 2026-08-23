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
  ShieldAlert,
} from 'lucide-react'
import { DiagnosticsData, AppSettings } from '../../types'
import { useTranslation } from '../../i18n'
import { isOllamaModelInstalled } from '../../services/hardwareRecommendationEngine'
import {
  type ModelIntent,
  filterModelsByIntent,
} from '../../services/modelIntentClassifier'

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

  const isModelInstalled = (name: string) => isOllamaModelInstalled(name, models)

  const buildModelOptions = (currentValue: string, presetOptions: string[], intent: ModelIntent) => {
    return filterModelsByIntent(models, intent, {
      includeCurrent: currentValue,
      presetOptions,
    })
  }

  const renderOption = (name: string, label: string) => {
    const installed = isModelInstalled(name)
    return (
      <option key={name} value={name}>
        {installed ? `✓ ${label} [${t('common.ready')}]` : `⬇ ${label} [${t('common.download')}]`}
      </option>
    )
  }

  return (
    <div className="space-y-5">
      {/* Module 1: AI Coding Agent Studio (Workhorse & Resilient Fallback) */}
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
                Configurazione del modello di sviluppo principale e del fallback di auto-healing per errori di memoria (OOM).
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
            <select
              aria-label="Seleziona Modello Coding Principale"
              value={settings.codingModel || settings.defaultModel || 'qwen2.5-coder:7b'}
              onChange={(e) => {
                onUpdateSettings({
                  codingModel: e.target.value,
                })
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus-ring font-mono font-semibold"
            >
              {buildModelOptions(
                settings.codingModel || '',
                ['qwen2.5-coder:7b', 'qwen3:8b', 'qwen2.5-coder:14b', 'qwen3:14b', 'gpt-oss:20b', 'codestral:22b', 'qwen2.5-coder:32b', 'deepseek-coder:6.7b', 'llama3.1:8b'],
                'coding'
              ).map((m) => renderOption(m, m))}
            </select>
            <p className="text-[10px] text-slate-400 leading-tight">
              Esegue i tool, scrive codice e mantiene la KV-cache fissa in GPU a zero latenza.
            </p>
          </div>

          {/* Resilient Fallback Model */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-amber-900/40 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-amber-400" /> Modello di Fallback (Auto-Healing OOM)
              </span>
              <span className="text-[10px] text-amber-400 font-mono font-bold">Sicurezza</span>
            </div>
            <select
              aria-label="Seleziona Modello di Fallback Coding"
              value={settings.codingFallbackModel || ''}
              onChange={(e) => onUpdateSettings({ codingFallbackModel: e.target.value || undefined })}
              className="w-full bg-slate-950 border border-amber-900/40 rounded-xl px-3 py-2 text-xs text-slate-100 focus-ring font-mono font-semibold"
            >
              <option value="">(Disattivato — Riprova sullo stesso modello)</option>
              {buildModelOptions(
                settings.codingFallbackModel || '',
                ['qwen2.5-coder:7b', 'llama3.2:3b', 'qwen2.5-coder:14b', 'qwen3:8b', 'codestral:22b'],
                'coding'
              )
                .filter((m) => m !== (settings.codingModel || 'qwen2.5-coder:7b'))
                .map((m) => renderOption(m, m))}
            </select>
            <p className="text-[10px] text-amber-500/80 leading-tight">
              Subentra automaticamente solo in caso di crash o Out Of Memory (OOM) del modello primario.
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
            <select
              aria-label="Select RAG & Chat model"
              value={settings.chatModel || 'llama3.1:8b'}
              onChange={(e) => onUpdateSettings({ chatModel: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus-ring font-mono font-semibold"
            >
              {buildModelOptions(
                settings.chatModel || '',
                ['llama3.1:8b', 'llama3.2:3b', 'qwen2.5:7b', 'mistral:7b', 'gemma2:9b', 'phi3.5:3.8b'],
                'chat'
              ).map((m) => renderOption(m, m))}
            </select>
          </div>

          <div className="space-y-1.5 pt-1">
            <label className="text-xs font-semibold text-slate-400 flex items-center gap-1">
              <ShieldAlert className="w-3 h-3 text-amber-400" /> Fallback Chat (Opzionale):
            </label>
            <select
              aria-label="Select Chat fallback model"
              value={settings.chatFallbackModel || ''}
              onChange={(e) => onUpdateSettings({ chatFallbackModel: e.target.value || undefined })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-300 focus-ring font-mono"
            >
              <option value="">(Disattivato)</option>
              {buildModelOptions(
                settings.chatFallbackModel || '',
                ['llama3.2:3b', 'llama3.1:8b', 'qwen2.5:7b', 'mistral:7b'],
                'chat'
              )
                .filter((m) => m !== (settings.chatModel || 'llama3.1:8b'))
                .map((m) => renderOption(m, m))}
            </select>
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
            <select
              aria-label="Select Document Translation model"
              value={settings.translationModel || 'qwen2.5:7b'}
              onChange={(e) => onUpdateSettings({ translationModel: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus-ring font-mono font-semibold"
            >
              {buildModelOptions(
                settings.translationModel || '',
                ['qwen2.5:7b', 'llama3.1:8b', 'aya-expanse:8b', 'gemma2:2b', 'gemma2:9b', 'qwen2.5:1.5b', 'mistral:7b'],
                'translation'
              ).map((m) => renderOption(m, m))}
            </select>
          </div>

          <div className="space-y-1.5 pt-1">
            <label className="text-xs font-semibold text-slate-400 flex items-center gap-1">
              <ShieldAlert className="w-3 h-3 text-amber-400" /> Fallback Traduzione (Opzionale):
            </label>
            <select
              aria-label="Select Translation fallback model"
              value={settings.translationFallbackModel || ''}
              onChange={(e) => onUpdateSettings({ translationFallbackModel: e.target.value || undefined })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-300 focus-ring font-mono"
            >
              <option value="">(Disattivato)</option>
              {buildModelOptions(
                settings.translationFallbackModel || '',
                ['qwen2.5:7b', 'llama3.2:3b', 'llama3.1:8b'],
                'translation'
              )
                .filter((m) => m !== (settings.translationModel || 'qwen2.5:7b'))
                .map((m) => renderOption(m, m))}
            </select>
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
            <select
              aria-label="Select Vision & OCR model"
              value={settings.visionModel || 'llama3.2-vision:11b'}
              onChange={(e) => onUpdateSettings({ visionModel: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus-ring font-mono font-semibold"
            >
              {buildModelOptions(
                settings.visionModel || '',
                ['llama3.2-vision:11b', 'llama3.2-vision:latest', 'minicpm-v:8b', 'llava:7b', 'llava:13b', 'moondream:latest'],
                'vision'
              ).map((m) => renderOption(m, m))}
            </select>
          </div>

          {/* Vector Embedding */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-purple-300">
              <span className="flex items-center gap-1.5">
                <Database className="w-4 h-4 text-purple-400" /> {t('settings.vectorStoreLabel')}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Embedding (768d / 1024d)</span>
            </div>
            <select
              aria-label="Select Vector Store Embedding model"
              value={settings.embeddingModel || 'nomic-embed-text'}
              onChange={(e) => onUpdateSettings({ embeddingModel: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus-ring font-mono font-semibold"
            >
              {buildModelOptions(
                settings.embeddingModel || '',
                ['nomic-embed-text', 'bge-m3', 'bge-large', 'all-minilm', 'mxbai-embed-large'],
                'embedding'
              ).map((m) => renderOption(m, m))}
            </select>
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
            <select
              aria-label="Select Medical & Clinical model"
              value={settings.medicalModel || ''}
              onChange={(e) => onUpdateSettings({ medicalModel: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus-ring font-mono font-semibold"
            >
              <option value="">{`-- ${t('common.none')} (${t('settings.chatModel')}) --`}</option>
              {buildModelOptions(
                settings.medicalModel || '',
                ['adrienbrault/biomistral-7b:Q4_K_M', 'meditron:7b', 'meditron:70b', 'llama3.1:8b'],
                'medical'
              ).map((m) => renderOption(m, m))}
            </select>
          </div>

          {/* Legal & Compliance */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-amber-300">
              <span className="flex items-center gap-1.5">
                <Scale className="w-4 h-4 text-amber-400" /> {t('settings.legalModel')}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Legal &amp; Normative</span>
            </div>
            <select
              aria-label="Select Legal & Compliance model"
              value={settings.legalModel || ''}
              onChange={(e) => onUpdateSettings({ legalModel: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus-ring font-mono font-semibold"
            >
              <option value="">{`-- ${t('common.none')} (${t('settings.chatModel')}) --`}</option>
              {buildModelOptions(
                settings.legalModel || '',
                ['llama3.1:8b', 'mistral:7b', 'command-r:35b', 'command-r-plus:104b'],
                'legal'
              ).map((m) => renderOption(m, m))}
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}
