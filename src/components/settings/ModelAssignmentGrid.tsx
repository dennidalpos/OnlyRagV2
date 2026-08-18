import React, { useState } from 'react'
import {
  Code,
  MessageSquare,
  Languages,
  FileText,
  Database,
  Eye,
  Zap,
  Activity,
  Scale,
} from 'lucide-react'
import { DiagnosticsData, AppSettings } from '../../types'
import { useTranslation } from '../../i18n'
import { isOllamaModelInstalled } from '../../services/hardwareRecommendationEngine'
import { logger } from '../../lib/logger'

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

  // Shared, tag-exact matcher. The local copy this replaced ended with a
  // `installed.split(':')[0] === base` branch that ignored the parameter tag entirely, so a
  // single installed `qwen2.5-coder:7b` made the grid label 1.5b / 3b / 14b / 32b as
  // "Pronto" too — while the setup wizard, already using this helper, said the opposite.
  const isModelInstalled = (name: string) => isOllamaModelInstalled(name, models)

  const buildModelOptions = (currentValue: string, presetOptions: string[]) => {
    const all = [
      currentValue,
      ...presetOptions,
      ...models,
    ].filter((m): m is string => Boolean(m && typeof m === 'string' && m.trim().length > 0))
    return Array.from(new Set(all))
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
      {/* Module 1: AI Coding Agent (Complexity Routing Tiers) */}
      <div className="glass-panel rounded-xl p-5 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <Code className="w-4.5 h-4.5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                {t('settings.codingAgentSection')}
              </h2>
              <p className="text-[11px] text-slate-400">
                {t('settings.codingAgentSubtitle')}
              </p>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs font-semibold text-slate-300 cursor-pointer select-none bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
            <input
              type="checkbox"
              checked={settings.useComplexityRouting !== false}
              onChange={(e) => onUpdateSettings({ useComplexityRouting: e.target.checked })}
              className="rounded bg-slate-950 border-slate-700 text-emerald-500 focus:ring-emerald-500/20"
            />
            <span
              className={
                settings.useComplexityRouting !== false
                  ? 'text-emerald-400 font-bold'
                  : 'text-slate-400'
              }
            >
              {settings.useComplexityRouting !== false
                ? t('settings.complexityRouterActive')
                : t('settings.complexityRouterDisabled')}
            </span>
          </label>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Fast Tier */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                🟢 {t('hardwareWizard.step2Title')}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Fast</span>
            </div>
            <select
              aria-label="Select Coding Fast Tier Model"
              value={settings.complexityFastModel || 'qwen2.5-coder:1.5b'}
              onChange={(e) => onUpdateSettings({ complexityFastModel: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus-ring font-mono font-semibold"
            >
              {buildModelOptions(
                settings.complexityFastModel || '',
                ['qwen2.5-coder:1.5b', 'llama3.2:3b', 'qwen2.5-coder:3b', 'llama3.2:1b', 'qwen2.5:1.5b']
              ).map((m) => renderOption(m, m))}
            </select>
          </div>

          {/* Standard Tier */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                🔵 {t('hardwareWizard.step3Title')}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Standard</span>
            </div>
            <select
              aria-label="Select Coding Standard Tier Model"
              value={settings.complexityStandardModel || settings.codingModel || 'qwen2.5-coder:7b'}
              onChange={(e) => {
                onUpdateSettings({
                  complexityStandardModel: e.target.value,
                  codingModel: e.target.value,
                })
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus-ring font-mono font-semibold"
            >
              {buildModelOptions(
                settings.complexityStandardModel || settings.codingModel || '',
                ['qwen2.5-coder:7b', 'llama3.2:3b', 'llama3.1:8b', 'codestral:22b', 'mistral:7b', 'deepseek-coder:6.7b']
              ).map((m) => renderOption(m, m))}
            </select>
          </div>

          {/* Deep Reasoning Tier */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-purple-300 flex items-center gap-1.5">
                🟣 {t('hardwareWizard.step4Title')}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Deep Reasoning</span>
            </div>
            <select
              aria-label="Select Coding Deep Reasoning Model"
              value={settings.complexityDeepModel || 'qwen2.5-coder:7b'}
              onChange={(e) => onUpdateSettings({ complexityDeepModel: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus-ring font-mono font-semibold"
            >
              {buildModelOptions(
                settings.complexityDeepModel || '',
                ['qwen2.5-coder:7b', 'deepseek-r1:8b', 'deepseek-r1:14b', 'qwen2.5-coder:14b', 'phi4:14b', 'deepseek-r1:32b']
              ).map((m) => renderOption(m, m))}
            </select>
          </div>

          {/* Heavy Escalation Tier (14B+) */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-amber-900/40 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                {t('hardwareWizard.heavyTierBadge')}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Escalation</span>
            </div>
            <select
              aria-label="Select Coding Heavy Escalation Tier Model"
              value={settings.complexityHeavyModel || ''}
              onChange={(e) => onUpdateSettings({ complexityHeavyModel: e.target.value || undefined })}
              className="w-full bg-slate-950 border border-amber-900/40 rounded-xl px-3 py-2 text-xs text-slate-100 focus-ring font-mono font-semibold"
            >
              <option value="">{t('settings.heavyTierDisabledOption')}</option>
              {buildModelOptions(
                settings.complexityHeavyModel || '',
                ['qwen2.5-coder:14b', 'deepseek-r1:14b', 'phi4:14b', 'codestral:22b', 'deepseek-r1:32b', 'qwen2.5-coder:32b']
              ).map((m) => renderOption(m, m))}
            </select>
            <p className="text-[10px] text-amber-500/70 leading-tight">
              {t('settings.heavyTierDesc')}
            </p>
          </div>
        </div>

      </div>

      {/* Module 2 & 3: RAG Chat & Document Translation */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* RAG & Chat */}
        <div className="glass-panel rounded-xl p-5 border border-slate-800 space-y-3">
          <div className="flex items-center gap-3 border-b border-slate-800/80 pb-2.5">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
              <MessageSquare className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100">{t('settings.ragChatSection')}</h2>
              <p className="text-[11px] text-slate-400">{t('settings.ragChatSubtitle')}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-cyan-300 block">{t('settings.chatModel')}:</label>
            <select
              aria-label="Select RAG & Chat model"
              value={settings.chatModel || 'llama3.1:8b'}
              onChange={(e) => onUpdateSettings({ chatModel: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus-ring font-mono font-semibold"
            >
              {buildModelOptions(
                settings.chatModel || '',
                ['llama3.1:8b', 'llama3.2:3b', 'qwen2.5:7b', 'mistral:7b', 'gemma2:9b']
              ).map((m) => renderOption(m, m))}
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
                ['qwen2.5:7b', 'aya-expanse:8b', 'gemma2:2b', 'gemma2:9b', 'qwen2.5:1.5b', 'mistral:7b']
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
                ['adrienbrault/biomistral-7b:Q4_K_M', 'meditron:7b', 'meditron:70b', 'llama3.1:8b']
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
                ['llama3.1:8b', 'mistral:7b', 'command-r:35b', 'command-r-plus:104b']
              ).map((m) => renderOption(m, m))}
            </select>
          </div>
        </div>
      </div>

      {/* Module 4: Ingestion, OCR & Vector Store */}
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
              value={settings.visionModel || 'llava:7b'}
              onChange={(e) => onUpdateSettings({ visionModel: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus-ring font-mono font-semibold"
            >
              {buildModelOptions(
                settings.visionModel || '',
                ['llava:7b', 'llama3.2-vision:11b', 'minicpm-v:8b', 'moondream:latest']
              ).map((m) => renderOption(m, m))}
            </select>
          </div>

          {/* Vector Embedding */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-purple-300">
              <span className="flex items-center gap-1.5">
                <Database className="w-4 h-4 text-purple-400" /> {t('settings.vectorStoreLabel')}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Vector Store</span>
            </div>
            <select
              aria-label="Select Vector Embedding model"
              value={settings.embeddingModel || 'nomic-embed-text:latest'}
              onChange={(e) => onUpdateSettings({ embeddingModel: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus-ring font-mono font-semibold"
            >
              {buildModelOptions(
                settings.embeddingModel || '',
                ['nomic-embed-text:latest', 'bge-m3:latest', 'snowflake-arctic-embed:latest', 'mxbai-embed-large:latest', 'all-minilm:latest']
              ).map((m) => renderOption(m, m))}
            </select>
          </div>
        </div>
      </div>

      {/* Model Performance Profiler */}
      <ModelPerformanceProfiler models={models} />
    </div>
  )
}

const ModelPerformanceProfiler: React.FC<{ models: string[] }> = ({ models }) => {
  const { t } = useTranslation()
  const [benchmarks, setBenchmarks] = useState<
    Record<string, { tokensPerSec: number; evalDurationMs: number; isEmbedding?: boolean; isRunning: boolean }>
  >({})

  const handleRunBenchmark = async (modelName: string) => {
    if (!window.electronAPI?.benchmarkModel) return
    setBenchmarks((prev) => ({ ...prev, [modelName]: { tokensPerSec: 0, evalDurationMs: 0, isRunning: true } }))

    try {
      const res = await window.electronAPI.benchmarkModel(modelName)
      if (res && res.success) {
        setBenchmarks((prev) => ({
          ...prev,
          [modelName]: {
            tokensPerSec: res.tokensPerSec,
            evalDurationMs: res.evalDurationMs,
            isEmbedding: res.isEmbedding,
            isRunning: false,
          },
        }))
      } else {
        setBenchmarks((prev) => ({ ...prev, [modelName]: { tokensPerSec: 0, evalDurationMs: 0, isRunning: false } }))
      }
    } catch (err: any) {
      logger.warn('ModelAssignmentGrid', `Benchmark model failed: ${err?.message || err}`)
      setBenchmarks((prev) => ({ ...prev, [modelName]: { tokensPerSec: 0, evalDurationMs: 0, isRunning: false } }))
    }
  }

  if (models.length === 0) return null

  return (
    <div className="glass-panel rounded-xl p-5 border border-slate-800 space-y-3">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
            <Zap className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-100">{t('settings.perfProfilerTitle')}</h3>
            <p className="text-[11px] text-slate-400">{t('settings.perfProfilerDesc')}</p>
          </div>
        </div>
        <span className="text-[10px] font-mono text-slate-400">
          {models.length} {t('settings.installedLocalModels')}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {models.map((m) => {
          const stats = benchmarks[m]
          const isEmbedModel = m.toLowerCase().includes('embed') || m.toLowerCase().includes('bge') || stats?.isEmbedding
          return (
            <div key={m} className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between text-xs font-mono">
              <div className="truncate pr-2">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="font-semibold text-slate-200 truncate">{m}</span>
                  {isEmbedModel && (
                    <span className="text-[9px] px-1.5 py-0.2 bg-purple-950 text-purple-300 rounded border border-purple-800/60 shrink-0 font-bold">
                      EMBED
                    </span>
                  )}
                </div>
                {stats?.tokensPerSec ? (
                  <span className="text-[11px] text-emerald-400 font-bold block mt-0.5">
                    ⚡ {stats.tokensPerSec} {isEmbedModel ? 'vec/s' : 't/s'} ({stats.evalDurationMs}ms)
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-400 block mt-0.5">{t('settings.perfProfilerNotTested')}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleRunBenchmark(m)}
                disabled={stats?.isRunning}
                aria-label={t('settings.perfProfilerBenchmarkAria', { model: m })}
                className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300 text-[11px] rounded-lg font-semibold shrink-0 transition-colors focus-ring active:scale-95"
              >
                {stats?.isRunning ? t('common.loading') : t('settings.perfProfilerTestBtn')}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
