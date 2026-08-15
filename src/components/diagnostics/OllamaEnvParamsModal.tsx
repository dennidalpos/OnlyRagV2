import React, { useState, useEffect } from 'react'
import { OllamaEnvConfig } from '../../services/hardwareRecommendationEngine'
import { Zap, X, Copy, Check, ShieldCheck } from 'lucide-react'

interface OllamaEnvParamsModalProps {
  isOpen: boolean
  onClose: () => void
  envConfig: OllamaEnvConfig
  onOpenApprovalModal: () => void
}

export const OllamaEnvParamsModal: React.FC<OllamaEnvParamsModalProps> = ({
  isOpen,
  onClose,
  envConfig,
  onOpenApprovalModal,
}) => {
  const [copiedScript, setCopiedScript] = useState<boolean>(false)

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleCopyPowerShell = async () => {
    await navigator.clipboard.writeText(envConfig.powershellScript)
    setCopiedScript(true)
    setTimeout(() => setCopiedScript(false), 2500)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ollama-env-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 id="ollama-env-modal-title" className="font-bold text-slate-100 text-sm">
                  Parametri OS Client Ollama
                </h3>
                <span className="px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 text-[10px] font-mono border border-amber-800/60 font-bold uppercase">
                  {envConfig.profileTier}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Variabili d'ambiente consigliate per ottimizzare VRAM, inferenza e concorrenza Ollama.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi"
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors focus-ring cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content: Formatted List */}
        <div className="p-5 space-y-3 overflow-y-auto flex-1 text-xs">
          <div className="grid grid-cols-1 gap-2.5">
            {envConfig.variables.map((v) => (
              <div
                key={v.name}
                className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1.5 hover:border-slate-700 transition-colors"
              >
                <div className="flex items-center justify-between font-mono">
                  <strong className="text-cyan-300 text-xs">{v.name}</strong>
                  <span className="px-2 py-0.5 rounded bg-slate-900 text-amber-300 font-bold border border-slate-700 text-xs">
                    {v.value}
                  </span>
                </div>
                <p className="text-slate-200 text-[11px] leading-relaxed font-sans">{v.description}</p>
                <p className="text-slate-400 text-[10px] italic font-sans">{v.rationale}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/80 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleCopyPowerShell}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-semibold rounded-xl transition-all focus-ring flex items-center gap-1.5 active:scale-95 cursor-pointer"
            title="Copia script PowerShell per impostare le variabili d'ambiente OS utente"
          >
            {copiedScript ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-cyan-400" />}
            <span>{copiedScript ? 'Script Copiato!' : 'Copia Script PowerShell'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-colors focus-ring cursor-pointer"
            >
              Chiudi
            </button>

            <button
              type="button"
              onClick={() => {
                onClose()
                onOpenApprovalModal()
              }}
              className="px-4 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-bold rounded-xl text-xs transition-all shadow-md flex items-center gap-1.5 active:scale-95 focus-ring cursor-pointer"
              title="Applica le variabili d'ambiente al sistema operativo (richiede conferma)"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Applica all'OS...</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
