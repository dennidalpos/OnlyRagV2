import React, { useState } from 'react'
import { Server, CheckCircle2, XCircle, Loader2, HardDrive, Wifi, Radio } from 'lucide-react'
import { AppSettings } from '../../types'
import { apiService } from '../../services/api'

interface OllamaServerConfigProps {
  settings: AppSettings
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void
  onRefreshDiagnostics?: () => void
}

export const OllamaServerConfig: React.FC<OllamaServerConfigProps> = ({
  settings,
  onUpdateSettings,
  onRefreshDiagnostics,
}) => {
  const currentMode = settings.ollamaMode || (settings.ollamaHost && !settings.ollamaHost.includes('127.0.0.1') && !settings.ollamaHost.includes('localhost') ? 'remote' : 'local')
  const [remoteUrl, setRemoteUrl] = useState(settings.ollamaHost && settings.ollamaHost !== 'http://127.0.0.1:11434' ? settings.ollamaHost : 'http://192.168.1.100:11434')
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; modelsCount?: number } | null>(null)

  const handleSelectMode = (mode: 'local' | 'remote') => {
    setTestResult(null)
    if (mode === 'local') {
      onUpdateSettings({
        ollamaMode: 'local',
        ollamaHost: 'http://127.0.0.1:11434',
      })
    } else {
      const targetHost = remoteUrl.trim().startsWith('http') ? remoteUrl.trim() : `http://${remoteUrl.trim()}`
      onUpdateSettings({
        ollamaMode: 'remote',
        ollamaHost: targetHost,
      })
    }
  }

  const handleRemoteUrlChange = (val: string) => {
    setRemoteUrl(val)
    setTestResult(null)
    const targetHost = val.trim().startsWith('http') ? val.trim() : `http://${val.trim()}`
    onUpdateSettings({
      ollamaHost: targetHost,
    })
  }

  const handleTestConnection = async () => {
    const targetHost = currentMode === 'local' ? 'http://127.0.0.1:11434' : (settings.ollamaHost || remoteUrl)
    setIsTesting(true)
    setTestResult(null)

    try {
      const res = await apiService.testOllamaConnection(targetHost)
      if (res.success) {
        setTestResult({
          success: true,
          message: `Connesso con successo al server Ollama (${res.modelsCount ?? 0} modelli rilevati)`,
          modelsCount: res.modelsCount,
        })
        if (onRefreshDiagnostics) onRefreshDiagnostics()
      } else {
        setTestResult({
          success: false,
          message: res.error || 'Impossibile raggiungere il server Ollama specificato',
        })
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Errore di rete durante la verifica della connessione',
      })
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <div className="glass-panel rounded-xl p-5 border border-slate-800 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
            <Server className="w-4.5 h-4.5 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              Server Ollama (Locale o Rete)
            </h2>
            <p className="text-[11px] text-slate-400">
              Scegli se eseguire i modelli AI su questo computer o collegarti a un server in rete locale/remoto.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Mode 1: Local PC */}
        <button
          type="button"
          onClick={() => handleSelectMode('local')}
          className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between space-y-2 ${
            currentMode === 'local'
              ? 'bg-cyan-950/40 border-cyan-500/50 shadow-md shadow-cyan-950/30 ring-1 ring-cyan-500/40'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-100 flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-cyan-400" /> Sullo stesso PC (Locale)
            </span>
            <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
              currentMode === 'local' ? 'border-cyan-400 bg-cyan-500' : 'border-slate-600'
            }`}>
              {currentMode === 'local' && <span className="w-1.5 h-1.5 rounded-full bg-slate-950" />}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Utilizza l'installazione locale di Ollama (<code className="font-mono text-cyan-300">http://127.0.0.1:11434</code>). Ideale per lavorare completamente offline con la GPU/CPU del computer.
          </p>
          <div className="text-[10px] font-mono text-cyan-400/80 pt-1">
            Endpoint: http://127.0.0.1:11434
          </div>
        </button>

        {/* Mode 2: Remote Network Server */}
        <button
          type="button"
          onClick={() => handleSelectMode('remote')}
          className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between space-y-2 ${
            currentMode === 'remote'
              ? 'bg-cyan-950/40 border-cyan-500/50 shadow-md shadow-cyan-950/30 ring-1 ring-cyan-500/40'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-100 flex items-center gap-2">
              <Wifi className="w-4 h-4 text-sky-400" /> Server in Rete Remoto
            </span>
            <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
              currentMode === 'remote' ? 'border-cyan-400 bg-cyan-500' : 'border-slate-600'
            }`}>
              {currentMode === 'remote' && <span className="w-1.5 h-1.5 rounded-full bg-slate-950" />}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Invia prompt, tool e indicizzazioni a un server Ollama condiviso o su workstation dedicata nella rete LAN/WiFi.
          </p>
          <div className="text-[10px] font-mono text-sky-400/80 pt-1">
            Endpoint: {settings.ollamaHost && settings.ollamaHost !== 'http://127.0.0.1:11434' ? settings.ollamaHost : remoteUrl}
          </div>
        </button>
      </div>

      {/* Remote Host URL Input (visible when remote is active) */}
      {currentMode === 'remote' && (
        <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2 animate-in fade-in">
          <label className="text-xs font-semibold text-slate-300 block">
            Indirizzo IP o Nome Host del Server Ollama:
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={remoteUrl}
              onChange={(e) => handleRemoteUrlChange(e.target.value)}
              placeholder="es. http://192.168.1.50:11434 oppure http://ai-server:11434"
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus-ring"
            />
          </div>
          <p className="text-[10px] text-slate-400">
            Assicurati che sul server remoto Ollama sia avviato con <code className="text-cyan-300 font-mono">OLLAMA_HOST=0.0.0.0</code> e che la porta sia accessibile.
          </p>
        </div>
      )}

      {/* Connection Test Action & Status */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={handleTestConnection}
          disabled={isTesting}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-all focus-ring flex items-center gap-2 active:scale-95 cursor-pointer disabled:opacity-50"
        >
          {isTesting ? <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" /> : <Radio className="w-3.5 h-3.5 text-cyan-400" />}
          {isTesting ? 'Verifica in corso...' : 'Test Connessione Server'}
        </button>

        {testResult && (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium border ${
            testResult.success
              ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/60'
              : 'bg-rose-950/40 text-rose-300 border-rose-800/60'
          }`}>
            {testResult.success ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{testResult.message}</span>
          </div>
        )}
      </div>
    </div>
  )
}
