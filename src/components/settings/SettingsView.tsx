import React, { useState } from 'react'
import { DiagnosticsData, AppSettings } from '../../types'
import { Settings, RefreshCw, Download, Trash2, Zap, Loader2 } from 'lucide-react'
import { HardwareSetupWizardModal } from '../common/HardwareSetupWizardModal'
import { ModelAssignmentGrid } from './ModelAssignmentGrid'
import { HardwareProfileSelector } from './HardwareProfileSelector'
import { TaskConcurrencyConfig } from './TaskConcurrencyConfig'
import { useSettingsManager } from '../../hooks/useSettingsManager'

interface SettingsViewProps {
  diagnostics: DiagnosticsData | null
  settings: AppSettings
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void
  onRefreshDiagnostics: () => void
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  diagnostics,
  settings,
  onUpdateSettings,
  onRefreshDiagnostics,
}) => {
  const s = useSettingsManager(diagnostics, settings, onUpdateSettings, onRefreshDiagnostics)
  const [deletingModel, setDeletingModel] = useState<string | null>(null)

  return (
    <div className="flex-1 h-full overflow-y-auto p-8 space-y-8 bg-slate-950 select-text">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-3">
            <Settings className="w-7 h-7 text-cyan-400" /> Impostazioni &amp; Hardware
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Configurazione modelli locali AI, profili di accelerazione hardware e gestione Ollama.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => s.setIsWizardOpen(true)}
            aria-label="Avvia Wizard Hardware"
            className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 text-slate-950 font-bold text-xs rounded-xl transition-all focus-ring flex items-center gap-2 shadow-lg shadow-cyan-950/50 active:scale-95"
          >
            <Zap className="w-4 h-4 fill-current" /> Wizard Hardware
          </button>

          <button
            onClick={onRefreshDiagnostics}
            aria-label="Aggiorna scansione hardware"
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-medium rounded-xl transition-colors focus-ring flex items-center gap-2 active:scale-95"
          >
            <RefreshCw className="w-4 h-4 text-cyan-400" /> Scansione Hardware
          </button>
        </div>
      </div>

      {/* Per-Section Model Assignment Grid */}
      <ModelAssignmentGrid
        settings={settings}
        diagnostics={diagnostics}
        onUpdateSettings={onUpdateSettings}
      />

      {/* Hardware Profile Selector */}
      <HardwareProfileSelector
        settings={settings}
        onUpdateSettings={onUpdateSettings}
      />

      {/* Task Concurrency & Queue Configuration */}
      <TaskConcurrencyConfig
        settings={settings}
        onUpdateSettings={onUpdateSettings}
      />

      {/* Ollama Model Management Panel */}
      <div className="glass-panel rounded-xl p-6 border border-slate-800 space-y-4">
        <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
          <Download className="w-5 h-5 text-cyan-400" /> Gestione Modelli Ollama
        </h2>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            s.handlePullModel()
          }}
          className="flex items-center gap-3"
        >
          <input
            type="text"
            value={s.pullModelInput}
            onChange={(e) => s.setPullModelInput(e.target.value)}
            placeholder="es. llama3.2, mistral, nomic-embed-text, qwen2.5-coder..."
            aria-label="Nome modello Ollama da scaricare"
            className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 outline-none flex-1 focus-ring"
          />
          <button
            type="submit"
            disabled={s.isPulling || !s.pullModelInput.trim()}
            aria-label={s.isPulling ? 'Download del modello in corso' : 'Scarica modello Ollama'}
            className="px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold text-xs rounded-xl transition-colors focus-ring flex items-center gap-2 active:scale-95"
          >
            {s.isPulling ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                <span>Download...</span>
              </>
            ) : (
              <span>Scarica Modello</span>
            )}
          </button>
        </form>

        {s.pullMessage && <p className="text-xs text-cyan-300 font-mono">{s.pullMessage}</p>}

        <div className="space-y-2 pt-2">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Modelli Locali Installati</h3>
          {diagnostics?.ollama.models && diagnostics.ollama.models.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {diagnostics.ollama.models.map((modelName) => (
                <div key={modelName} className="p-3 bg-slate-900 rounded-xl border border-slate-800 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-slate-200">{modelName}</div>
                  </div>
                  {deletingModel === modelName ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => { s.handleDeleteModel(modelName); setDeletingModel(null) }}
                        className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold text-[10px] rounded-lg transition-colors focus-ring"
                      >
                        Conferma?
                      </button>
                      <button
                        onClick={() => setDeletingModel(null)}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] rounded-lg transition-colors focus-ring"
                      >
                        Annulla
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeletingModel(modelName)}
                      className="p-1.5 text-slate-400 hover:text-red-400 transition-colors focus-ring"
                      title="Elimina modello"
                      aria-label={`Elimina modello ${modelName}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">Nessun modello locale rilevato.</p>
          )}
        </div>
      </div>

      <HardwareSetupWizardModal
        isOpen={s.isWizardOpen}
        onClose={() => s.setIsWizardOpen(false)}
        diagnostics={diagnostics}
        settings={settings}
        onUpdateSettings={onUpdateSettings}
        onRefreshDiagnostics={onRefreshDiagnostics}
      />
    </div>
  )
}
