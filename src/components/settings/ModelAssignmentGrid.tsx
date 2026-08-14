import React from 'react'
import {
  Code,
  MessageSquare,
  Languages,
  FileText,
  Database,
  Sparkles,
  Cpu,
  Layers,
  Eye,
  Zap,
} from 'lucide-react'
import { DiagnosticsData, AppSettings } from '../../types'

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
  const models = diagnostics?.ollama.models || []

  const isModelInstalled = (name: string) => {
    if (!name) return false
    const clean = name.trim().toLowerCase()
    const base = clean.split(':')[0]
    return models.some((d) => {
      const dClean = d.toLowerCase().trim()
      return dClean === clean || dClean === `${clean}:latest` || `${dClean}:latest` === clean || dClean.split(':')[0] === base
    })
  }

  const renderOption = (name: string, label: string) => {
    const installed = isModelInstalled(name)
    return (
      <option key={name} value={name}>
        {installed ? `✓ ${label} [Installato]` : `⬇ ${label} [Da scaricare]`}
      </option>
    )
  }

  return (
    <div className="space-y-6">
      {/* Module 1: AI Coding Agent (Complexity Routing Tiers) */}
      <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <Code className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                1. AI Coding Agent <span className="text-emerald-400">— Complexity Router Tiers</span>
              </h2>
              <p className="text-xs text-slate-400">
                Smistamento dinamico in tempo reale in base alla complessità del prompt, file allegati e refactoring
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
            <span className={settings.useComplexityRouting !== false ? 'text-emerald-400' : 'text-slate-500'}>
              {settings.useComplexityRouting !== false ? 'Complexity Router Attivo' : 'Router Disattivato'}
            </span>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Fast Tier */}
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                🟢 Livello Fast (&lt;3B)
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Domande veloci</span>
            </div>
            <p className="text-[11px] text-slate-400">Spiegazioni rapide, snippet brevi e consultazione concettuale.</p>
            <select
              aria-label="Select Coding Fast Tier Model"
              value={settings.complexityFastModel || 'qwen2.5:3b'}
              onChange={(e) => onUpdateSettings({ complexityFastModel: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus-ring font-mono font-semibold"
            >
              {renderOption('qwen2.5:3b', 'qwen2.5:3b (Consigliato Fast)')}
              {renderOption('llama3.2:3b', 'llama3.2:3b')}
              {renderOption('llama3.2:1b', 'llama3.2:1b')}
              {models.filter((m) => !['qwen2.5:3b', 'llama3.2:3b', 'llama3.2:1b'].includes(m)).map((m) => renderOption(m, m))}
            </select>
          </div>

          {/* Standard Tier */}
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                🔵 Livello Standard (7B-8B)
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Editing & Tools</span>
            </div>
            <p className="text-[11px] text-slate-400">Modifica file, esecuzione comandi terminale e tool calling strutturato.</p>
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
              {renderOption('qwen2.5-coder:7b', 'qwen2.5-coder:7b (Consigliato Standard)')}
              {renderOption('llama3.1:8b', 'llama3.1:8b')}
              {renderOption('codellama:7b', 'codellama:7b')}
              {renderOption('mistral:7b', 'mistral:7b')}
              {models.filter((m) => !['qwen2.5-coder:7b', 'llama3.1:8b', 'codellama:7b', 'mistral:7b'].includes(m)).map((m) => renderOption(m, m))}
            </select>
          </div>

          {/* Deep Reasoning Tier */}
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-purple-300 flex items-center gap-1.5">
                🟣 Deep Reasoning (8B-14B)
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Refactor & Debug</span>
            </div>
            <p className="text-[11px] text-slate-400">Refactoring multi-file, analisi stack trace e ragionamento profondo.</p>
            <select
              aria-label="Select Coding Deep Reasoning Model"
              value={settings.complexityDeepModel || 'deepseek-r1:8b'}
              onChange={(e) => onUpdateSettings({ complexityDeepModel: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus-ring font-mono font-semibold"
            >
              {renderOption('deepseek-r1:8b', 'deepseek-r1:8b (Consigliato Reasoning)')}
              {renderOption('deepseek-r1:14b', 'deepseek-r1:14b')}
              {renderOption('qwen2.5-coder:14b', 'qwen2.5-coder:14b')}
              {models.filter((m) => !['deepseek-r1:8b', 'deepseek-r1:14b', 'qwen2.5-coder:14b'].includes(m)).map((m) => renderOption(m, m))}
            </select>
          </div>
        </div>
      </div>

      {/* Module 2 & 3: RAG Chat & Document Translation */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* RAG & Chat */}
        <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
          <div className="flex items-center gap-3 border-b border-slate-800/80 pb-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">2. Multi-Document RAG & Chat</h2>
              <p className="text-xs text-slate-400">Interrogazione semantica con citazioni e chunk LanceDB</p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-cyan-300 block">Modello RAG Chat Attivo:</label>
            <select
              aria-label="Select RAG & Chat model"
              value={settings.chatModel || settings.complexityStandardModel || settings.defaultModel || ''}
              onChange={(e) => onUpdateSettings({ chatModel: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-100 focus-ring font-mono font-semibold"
            >
              <option value="">Usa Standard Wizard ({settings.complexityStandardModel || settings.defaultModel || 'Auto'})</option>
              {models.map((m) => renderOption(m, m))}
            </select>
            <p className="text-[11px] text-slate-500">
              Eredita di default il modello Standard Tier configurato nel Setup Wizard.
            </p>
          </div>
        </div>

        {/* Doc Translation */}
        <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
          <div className="flex items-center gap-3 border-b border-slate-800/80 pb-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center">
              <Languages className="w-5 h-5 text-sky-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">3. Document Translation Engine</h2>
              <p className="text-xs text-slate-400">Traduzione sequenziale preservando tabelle e layout markdown</p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-sky-300 block">Modello Traduzione Attivo:</label>
            <select
              aria-label="Select Document Translation model"
              value={settings.translationModel || settings.complexityStandardModel || settings.defaultModel || ''}
              onChange={(e) => onUpdateSettings({ translationModel: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-100 focus-ring font-mono font-semibold"
            >
              <option value="">Usa Standard Wizard ({settings.complexityStandardModel || settings.defaultModel || 'Auto'})</option>
              {models.map((m) => renderOption(m, m))}
            </select>
            <p className="text-[11px] text-slate-500">
              Eredita di default il modello Standard Tier configurato nel Setup Wizard.
            </p>
          </div>
        </div>
      </div>

      {/* Module 4: Ingestion, OCR & Vector Store */}
      <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
        <div className="flex items-center gap-3 border-b border-slate-800/80 pb-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
            <FileText className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-100">4. Document Ingestion, OCR & Vector Store</h2>
            <p className="text-xs text-slate-400">Elaborazione layout Docling/PyMuPDF, OCR visivo e vettorizzazione LanceDB</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Vision OCR */}
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-amber-300">
              <span className="flex items-center gap-1.5"><Eye className="w-4 h-4 text-amber-400" /> Modello Vision & Diagram OCR</span>
              <span className="text-[10px] text-slate-500 font-mono">Vision OCR Tab</span>
            </div>
            <select
              aria-label="Select Vision & OCR model"
              value={settings.visionModel || 'llama3.2-vision'}
              onChange={(e) => onUpdateSettings({ visionModel: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus-ring font-mono font-semibold"
            >
              {renderOption('llama3.2-vision', 'llama3.2-vision (Consigliato)')}
              {renderOption('llava', 'llava')}
              {renderOption('minicpm-v', 'minicpm-v')}
              {models.filter((m) => !['llama3.2-vision', 'llava', 'minicpm-v'].includes(m)).map((m) => renderOption(m, m))}
            </select>
            <p className="text-[11px] text-slate-500">Utilizzato per l'ispezione diagrammi e OCR multimodale.</p>
          </div>

          {/* Vector Embedding */}
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-purple-300">
              <span className="flex items-center gap-1.5"><Database className="w-4 h-4 text-purple-400" /> Modello Vector Embedding (LanceDB)</span>
              <span className="text-[10px] text-slate-500 font-mono">Vector Store</span>
            </div>
            <select
              aria-label="Select Vector Embedding model"
              value={settings.embeddingModel || 'nomic-embed-text'}
              onChange={(e) => onUpdateSettings({ embeddingModel: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus-ring font-mono font-semibold"
            >
              {renderOption('nomic-embed-text', 'nomic-embed-text (Predefinito 768d)')}
              {renderOption('bge-m3:latest', 'bge-m3:latest (Multilingua 1024d)')}
              {renderOption('bge-large', 'bge-large')}
              {renderOption('all-minilm', 'all-minilm')}
              {models.filter((m) => !['nomic-embed-text', 'bge-m3:latest', 'bge-large', 'all-minilm'].includes(m)).map((m) => renderOption(m, m))}
            </select>
            <p className="text-[11px] text-slate-500">Utilizzato dal sidecar Python e LanceDB per la ricerca semantica ibrida.</p>
          </div>
        </div>
      </div>

      {/* Model Performance Profiler */}
      <ModelPerformanceProfiler models={models} />
    </div>
  )
}

const ModelPerformanceProfiler: React.FC<{ models: string[] }> = ({ models }) => {
  const [benchmarks, setBenchmarks] = React.useState<
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
      console.warn('Benchmark model failed:', err)
      setBenchmarks((prev) => ({ ...prev, [modelName]: { tokensPerSec: 0, evalDurationMs: 0, isRunning: false } }))
    }
  }

  if (models.length === 0) return null

  return (
    <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
            <Zap className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100">Profilatore Prestazioni Modelli</h3>
            <p className="text-xs text-slate-400">Misurazione throughput nativo Ollama (Tokens/sec per LLM &amp; Latency per Embedding)</p>
          </div>
        </div>
        <span className="text-[11px] font-mono text-slate-400">
          {models.length} Modelli Rilevati
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {models.map((m) => {
          const stats = benchmarks[m]
          const isEmbedModel = m.toLowerCase().includes('embed') || m.toLowerCase().includes('bge') || stats?.isEmbedding
          return (
            <div key={m} className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between text-xs font-mono">
              <div className="truncate pr-2">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="font-semibold text-slate-200 truncate">{m}</span>
                  {isEmbedModel && (
                    <span className="text-[9px] px-1.5 py-0.5 bg-purple-950 text-purple-300 rounded border border-purple-800/60 shrink-0 font-bold">
                      EMBED
                    </span>
                  )}
                </div>
                {stats?.tokensPerSec ? (
                  <span className="text-[11px] text-emerald-400 font-bold block mt-1">
                    ⚡ {stats.tokensPerSec} {isEmbedModel ? 'vec/s' : 't/s'} ({stats.evalDurationMs}ms)
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-500 block mt-1">Non testato</span>
                )}
              </div>
              <button
                onClick={() => handleRunBenchmark(m)}
                disabled={stats?.isRunning}
                aria-label={`Avvia test prestazioni per ${m}`}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300 text-[11px] rounded-lg font-semibold shrink-0 transition-colors focus-ring active:scale-95"
              >
                {stats?.isRunning ? 'Test...' : 'Test Speed'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
