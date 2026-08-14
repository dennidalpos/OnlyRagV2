import React, { useState, useEffect, useRef } from 'react'
import { AppSettings, DiagnosticsData } from '../../types'
import {
  analyzeHardwareAndRecommend,
  HardwareRecommendations,
  ModelRecommendation,
} from '../../services/hardwareRecommendationEngine'
import {
  Cpu,
  Zap,
  Check,
  ChevronRight,
  ChevronLeft,
  X,
  AlertTriangle,
  Download,
  ShieldCheck,
  Database,
  Layers,
  Sparkles,
  Info,
  StopCircle,
} from 'lucide-react'

interface HardwareSetupWizardModalProps {
  isOpen: boolean
  onClose: () => void
  diagnostics: DiagnosticsData | null
  settings: AppSettings
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void
  onRefreshDiagnostics: () => void
}

export const HardwareSetupWizardModal: React.FC<HardwareSetupWizardModalProps> = ({
  isOpen,
  onClose,
  diagnostics,
  settings,
  onUpdateSettings,
  onRefreshDiagnostics,
}) => {
  const [step, setStep] = useState<number>(1)
  const recommendations: HardwareRecommendations = analyzeHardwareAndRecommend(diagnostics)

  const downloadedModels = diagnostics?.ollama.models || []

  const recFast = recommendations.fastTierModels.find((m) => m.isRecommended)?.modelName || recommendations.fastTierModels[0].modelName
  const recStandard = recommendations.standardTierModels.find((m) => m.isRecommended)?.modelName || recommendations.standardTierModels[0].modelName
  const recDeep = recommendations.deepReasoningTierModels.find((m) => m.isRecommended)?.modelName || recommendations.deepReasoningTierModels[0].modelName
  const recVision = recommendations.visionTierModels.find((m) => m.isRecommended)?.modelName || recommendations.visionTierModels[0].modelName
  const recEmbedding = recommendations.embeddingTierModels.find((m) => m.isRecommended)?.modelName || recommendations.embeddingTierModels[0].modelName

  // Selected Model Slots for all 5 Tiers
  const [selectedFast, setSelectedFast] = useState<string>(
    settings.complexityFastModel || (downloadedModels.includes(recFast) ? recFast : downloadedModels.find((m) => m.includes('3b') || m.includes('1.5b')) || recFast)
  )
  const [selectedStandard, setSelectedStandard] = useState<string>(
    settings.complexityStandardModel || settings.codingModel || settings.defaultModel || (downloadedModels.includes(recStandard) ? recStandard : downloadedModels.find((m) => m.includes('7b') || m.includes('8b')) || recStandard)
  )
  const [selectedDeep, setSelectedDeep] = useState<string>(
    settings.complexityDeepModel || (downloadedModels.includes(recDeep) ? recDeep : downloadedModels.find((m) => m.includes('8b') && m.includes('r1')) || recDeep)
  )
  const [selectedVision, setSelectedVision] = useState<string>(
    settings.visionModel || (downloadedModels.includes(recVision) ? recVision : downloadedModels.find((m) => m.includes('vision') || m.includes('vl') || m.includes('minicpm') || m.includes('llava') || m.includes('moondream')) || recVision)
  )
  const [selectedEmbedding, setSelectedEmbedding] = useState<string>(
    settings.embeddingModel || (downloadedModels.includes(recEmbedding) ? recEmbedding : downloadedModels.find((m) => m.includes('embed') || m.includes('nomic')) || recEmbedding)
  )

  // Download & Installation Progress State
  const [isInstallingOllama, setIsInstallingOllama] = useState(false)
  const [isPullingModels, setIsPullingModels] = useState(false)
  const [pullingStatusText, setPullingStatusText] = useState('')
  const [pullProgressPercent, setPullProgressPercent] = useState(0)
  const [pullErrorDetail, setPullErrorDetail] = useState<string | null>(null)
  const isCancelledRef = useRef<boolean>(false)

  // Disk Space Pre-Check State
  const [diskCheck, setDiskCheck] = useState<{ allowed: boolean; requiredGB: number; freeGB: number; missingGB: number; error?: string } | null>(null)
  const [isCheckingDisk, setIsCheckingDisk] = useState(false)

  // Sync settings whenever modal is opened
  useEffect(() => {
    if (isOpen) {
      if (settings.complexityFastModel) setSelectedFast(settings.complexityFastModel)
      if (settings.complexityStandardModel || settings.codingModel || settings.defaultModel) {
        setSelectedStandard(settings.complexityStandardModel || settings.codingModel || settings.defaultModel)
      }
      if (settings.complexityDeepModel) setSelectedDeep(settings.complexityDeepModel)
      if (settings.visionModel) setSelectedVision(settings.visionModel)
      if (settings.embeddingModel) setSelectedEmbedding(settings.embeddingModel)
      setPullErrorDetail(null)
      setIsPullingModels(false)
      isCancelledRef.current = false
    }
  }, [isOpen, settings])

  // Live Stream Progress Listener
  useEffect(() => {
    if (!window.electronAPI?.onOllamaPullProgress) return
    const unsub = window.electronAPI.onOllamaPullProgress((data) => {
      if (data.total && data.completed && data.total > 0) {
        const pct = Math.min(99, Math.round((data.completed / data.total) * 100))
        setPullProgressPercent(pct)
        const mbCompleted = (data.completed / (1024 * 1024)).toFixed(0)
        const mbTotal = (data.total / (1024 * 1024)).toFixed(0)
        setPullingStatusText(`Scaricamento [${data.modelName}]: ${data.status} (${mbCompleted}/${mbTotal} MB - ${pct}%)`)
      } else if (data.status) {
        setPullingStatusText(`[${data.modelName}]: ${data.status}`)
      }
    })
    return () => {
      unsub()
    }
  }, [])

  const isModelDownloaded = (modelName: string): boolean => {
    if (!modelName) return false
    const clean = modelName.trim().toLowerCase()
    const base = clean.split(':')[0]
    return downloadedModels.some((d) => {
      const dClean = d.toLowerCase().trim()
      return dClean === clean || dClean === `${clean}:latest` || `${dClean}:latest` === clean || dClean.split(':')[0] === base
    })
  }

  // Check which of the 5 selected models are missing in Ollama
  const missingModels = [
    selectedFast,
    selectedStandard,
    selectedDeep,
    selectedVision,
    selectedEmbedding,
  ].filter((m) => m && !isModelDownloaded(m.trim()))

  // Check Disk Space when entering Step 6
  useEffect(() => {
    if (step === 6 && missingModels.length > 0 && window.electronAPI?.checkDiskSpace) {
      setIsCheckingDisk(true)
      window.electronAPI
        .checkDiskSpace(missingModels)
        .then((res) => {
          setDiskCheck(res)
          setIsCheckingDisk(false)
        })
        .catch((err) => {
          console.error('Disk space check failed:', err)
          setIsCheckingDisk(false)
        })
    }
  }, [step, missingModels.join(',')])

  // ESC Key Listener for Accessibility
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPullingModels) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isPullingModels, onClose])

  if (!isOpen) return null

  // Strict Validation: ALL 5 slots must be populated
  const isAllSlotsPopulated =
    !!selectedFast.trim() &&
    !!selectedStandard.trim() &&
    !!selectedDeep.trim() &&
    !!selectedVision.trim() &&
    !!selectedEmbedding.trim()

  const handleLaunchOrInstallOllama = async () => {
    if (!window.electronAPI?.installOrLaunchOllama) return
    setIsInstallingOllama(true)
    try {
      await window.electronAPI.installOrLaunchOllama()
      onRefreshDiagnostics()
    } catch (err) {
      console.error('Failed launching/installing Ollama:', err)
    } finally {
      setIsInstallingOllama(false)
    }
  }

  const handleCancelPull = async () => {
    isCancelledRef.current = true
    setIsPullingModels(false)
    setPullingStatusText('Download interrotto dall\'utente.')
    if (window.electronAPI?.cancelPullOllamaModel) {
      try {
        await window.electronAPI.cancelPullOllamaModel()
      } catch (err) {
        console.error('Error cancelling Ollama pull:', err)
      }
    }
  }

  const handleStartBulkPull = async () => {
    if (!window.electronAPI || missingModels.length === 0) {
      handleFinalSave()
      return
    }

    if (diskCheck && !diskCheck.allowed) {
      alert(
        `Spazio su disco insufficiente per avviare il download dei modelli!\n\nSpazio Libero su Disco: ${diskCheck.freeGB} GB\nSpazio Stimato Richiesto: ${diskCheck.requiredGB} GB\nSpazio Mancante: ${diskCheck.missingGB} GB\n\nLibera spazio su disco o deseleziona alcuni modelli prima di proseguire.`
      )
      return
    }

    isCancelledRef.current = false
    setIsPullingModels(true)
    setPullErrorDetail(null)
    let hasError = false

    for (let i = 0; i < missingModels.length; i++) {
      if (isCancelledRef.current) {
        hasError = true
        break
      }
      const modelToPull = missingModels[i]
      setPullingStatusText(`Connessione e download [${i + 1}/${missingModels.length}]: ${modelToPull}...`)
      setPullProgressPercent(0)

      try {
        const res = await window.electronAPI.pullOllamaModel(modelToPull)
        if (isCancelledRef.current) {
          hasError = true
          break
        }
        if (res && res.success) {
          onRefreshDiagnostics()
        } else {
          hasError = true
          const errDetail = res?.error || 'Download non completato. Verifica che Ollama sia attivo.'
          setPullErrorDetail(`Errore download per ${modelToPull}: ${errDetail}`)
          setPullingStatusText(`Errore [${modelToPull}]: ${errDetail}`)
          console.error(`Failed pulling ${modelToPull}:`, errDetail)
          break
        }
      } catch (err: any) {
        if (isCancelledRef.current) {
          hasError = true
          break
        }
        hasError = true
        const errMsg = err?.message || 'Eccezione imprevista durante il download'
        setPullErrorDetail(`Errore imprevisto per ${modelToPull}: ${errMsg}`)
        setPullingStatusText(`Errore [${modelToPull}]: ${errMsg}`)
        console.error(`Failed pulling ${modelToPull}:`, err)
        break
      }
    }

    if (!hasError && !isCancelledRef.current) {
      setPullProgressPercent(100)
      setPullingStatusText('Tutti i modelli scaricati con successo!')
      setIsPullingModels(false)
      handleFinalSave()
    } else {
      setIsPullingModels(false)
    }
  }

  const handleFinalSave = () => {
    onUpdateSettings({
      defaultModel: selectedStandard,
      useComplexityRouting: true,
      complexityFastModel: selectedFast,
      complexityStandardModel: selectedStandard,
      complexityDeepModel: selectedDeep,
      codingModel: selectedStandard,
      chatModel: selectedStandard,
      translationModel: selectedStandard,
      visionModel: selectedVision,
      embeddingModel: selectedEmbedding,
    })
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-modal-title"
      className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl flex flex-col shadow-2xl overflow-hidden max-h-[90vh]">
        {/* Wizard Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-sky-600 flex items-center justify-center border border-cyan-400/30">
              <Cpu className="w-5 h-5 text-slate-950 fill-current" />
            </div>
            <div>
              <h2 id="wizard-modal-title" className="text-base font-bold text-slate-100 flex items-center gap-2">
                Hardware & Model Setup Wizard <span className="text-cyan-400">— Step {step}/6</span>
              </h2>
              <p className="text-xs text-slate-400">
                Ottimizzazione guidata dell'hardware locale e configurazione dei modelli AI.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Chiudi Wizard Configurazione Hardware"
            className="p-2 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-xl transition-colors focus-ring active:scale-95"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Content */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {/* STEP 1: Hardware Scan & Ollama Status */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-cyan-400" /> Risultati Scansione Hardware Nativa
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-slate-400 block text-[11px]">Profilo Rilevato:</span>
                    <span className="font-semibold text-cyan-300">{recommendations.profileName}</span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-slate-400 block text-[11px]">Accelerazione Grafica:</span>
                    <span className="font-semibold text-slate-200 font-mono">{recommendations.gpuSummary}</span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 col-span-1 md:col-span-2">
                    <span className="text-slate-400 block text-[11px]">Memoria RAM di Sistema:</span>
                    <span className="font-semibold text-slate-200 font-mono">{recommendations.ramSummary}</span>
                  </div>
                </div>
              </div>

              {/* Ollama Status & Launch Card */}
              <div className={`p-4 rounded-xl border flex items-center justify-between transition-all ${diagnostics?.ollama.status === 'online' ? 'bg-emerald-950/30 border-emerald-500/50' : 'bg-rose-950/30 border-rose-500/50'}`}>
                <div className="flex items-center gap-3">
                  <Zap className={`w-6 h-6 ${diagnostics?.ollama.status === 'online' ? 'text-emerald-400' : 'text-rose-400'}`} />
                  <div>
                    <div className="font-bold text-sm text-slate-100 flex items-center gap-2">
                      <span>Stato Ollama Local Server:</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-mono font-bold capitalize ${diagnostics?.ollama.status === 'online' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-rose-950 text-rose-300 border border-rose-800'}`}>
                        {diagnostics?.ollama.status || 'Offline'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {diagnostics?.ollama.status === 'online'
                        ? `${downloadedModels.length} modelli già installati e pronti all'uso.`
                        : 'Ollama non è in esecuzione su http://localhost:11434.'}
                    </p>
                  </div>
                </div>

                {diagnostics?.ollama.status !== 'online' && (
                  <button
                    onClick={handleLaunchOrInstallOllama}
                    disabled={isInstallingOllama}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold text-xs rounded-xl transition-all flex items-center gap-1.5 shrink-0"
                  >
                    <Download className="w-4 h-4" /> {isInstallingOllama ? 'Installazione / Avvio...' : 'Installa / Avvia Ollama'}
                  </button>
                )}
              </div>

              {/* Quick Auto-Apply Card */}
              <div className="p-4 rounded-xl bg-cyan-950/20 border border-cyan-500/30 flex items-center justify-between">
                <div className="space-y-1">
                  <span className="font-bold text-xs text-cyan-300 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-cyan-400" /> Configurazione Rapida Consigliata
                  </span>
                  <p className="text-[11px] text-slate-400">
                    Imposta automaticamente tutti i modelli ottimali rilevati ({recFast}, {recStandard}, {recDeep}, {recVision}, {recEmbedding}) per il profilo {recommendations.profileName}.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFast(recFast)
                    setSelectedStandard(recStandard)
                    setSelectedDeep(recDeep)
                    setSelectedVision(recVision)
                    setSelectedEmbedding(recEmbedding)
                    setStep(6)
                  }}
                  className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 text-slate-950 font-bold text-xs rounded-xl transition-all focus-ring shrink-0 shadow-md shadow-cyan-950/40 active:scale-95"
                >
                  Applica &amp; Verifica (1-Click)
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: 🟢 Fast Tier Selection */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-emerald-300 flex items-center gap-2">
                  🟢 Selezione Modello Livello Fast (Bassa Complessità)
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Utilizzato per risposte ultra-rapide (&lt; 1 secondo), spiegazioni brevi e compiti concettuali semplici.
                </p>
              </div>

              <div className="space-y-2.5" role="radiogroup" aria-label="Seleziona modello livello Fast">
                {recommendations.fastTierModels.map((m) => {
                  const isSelected = selectedFast === m.modelName
                  return (
                    <div
                      key={m.modelName}
                      role="radio"
                      aria-checked={isSelected}
                      tabIndex={0}
                      onClick={() => setSelectedFast(m.modelName)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setSelectedFast(m.modelName)
                        }
                      }}
                      className={`p-3.5 rounded-xl border cursor-pointer flex items-center justify-between transition-all focus-ring ${
                        isSelected
                          ? 'bg-emerald-950/40 border-emerald-500 shadow-md'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${isSelected ? 'border-emerald-400 bg-emerald-500' : 'border-slate-600'}`}>
                          {isSelected && <Check className="w-3 h-3 text-slate-950 font-bold" />}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-200 text-xs flex items-center gap-2">
                            <span>{m.displayName}</span>
                            {m.isRecommended && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 font-mono font-bold border border-emerald-800">
                                CONSIGLIATO PER IL TUO HARDWARE
                              </span>
                            )}
                            {isModelDownloaded(m.modelName) && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 font-mono font-bold border border-cyan-800">
                                GIÀ INSTALLATO
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">{m.description}</p>
                        </div>
                      </div>
                      <span className="font-mono text-slate-400 text-xs shrink-0">{m.sizeBytesApprox}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* STEP 3: 🔵 Standard Tier Selection */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-cyan-300 flex items-center gap-2">
                  🔵 Selezione Modello Livello Standard (Media Complessità)
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Modello principale di lavoro per task di codice standard, modifiche file e RAG sui documenti.
                </p>
              </div>

              <div className="space-y-2.5" role="radiogroup" aria-label="Seleziona modello livello Standard">
                {recommendations.standardTierModels.map((m) => {
                  const isSelected = selectedStandard === m.modelName
                  return (
                    <div
                      key={m.modelName}
                      role="radio"
                      aria-checked={isSelected}
                      tabIndex={0}
                      onClick={() => setSelectedStandard(m.modelName)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setSelectedStandard(m.modelName)
                        }
                      }}
                      className={`p-3.5 rounded-xl border cursor-pointer flex items-center justify-between transition-all focus-ring active:scale-[0.99] ${
                        isSelected
                          ? 'bg-cyan-950/40 border-cyan-500 shadow-md'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${isSelected ? 'border-cyan-400 bg-cyan-500' : 'border-slate-600'}`}>
                          {isSelected && <Check className="w-3 h-3 text-slate-950 font-bold" />}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-200 text-xs flex items-center gap-2">
                            <span>{m.displayName}</span>
                            {m.isRecommended && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 font-mono font-bold border border-cyan-800">
                                CONSIGLIATO PER IL TUO HARDWARE
                              </span>
                            )}
                            {downloadedModels.includes(m.modelName) && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 font-mono font-bold border border-emerald-800">
                                GIÀ INSTALLATO
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">{m.description}</p>
                        </div>
                      </div>
                      <span className="font-mono text-slate-400 text-xs shrink-0">{m.sizeBytesApprox}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* STEP 4: 🟣 Deep Reasoning Tier Selection */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-purple-300 flex items-center gap-2">
                  🟣 Selezione Modello Livello Deep Reasoning (Alta Complessità)
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Modello avanzato per ragionamenti complessi, refactoring multi-file, debug di stack trace e DeepSeek-R1.
                </p>
              </div>

              <div className="space-y-2.5" role="radiogroup" aria-label="Seleziona modello livello Deep Reasoning">
                {recommendations.deepReasoningTierModels.map((m) => {
                  const isSelected = selectedDeep === m.modelName
                  return (
                    <div
                      key={m.modelName}
                      role="radio"
                      aria-checked={isSelected}
                      tabIndex={0}
                      onClick={() => setSelectedDeep(m.modelName)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setSelectedDeep(m.modelName)
                        }
                      }}
                      className={`p-3.5 rounded-xl border cursor-pointer flex items-center justify-between transition-all focus-ring active:scale-[0.99] ${
                        isSelected
                          ? 'bg-purple-950/40 border-purple-500 shadow-md'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${isSelected ? 'border-purple-400 bg-purple-500' : 'border-slate-600'}`}>
                          {isSelected && <Check className="w-3 h-3 text-slate-950 font-bold" />}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-200 text-xs flex items-center gap-2">
                            <span>{m.displayName}</span>
                            {m.isRecommended && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 font-mono font-bold border border-purple-800">
                                CONSIGLIATO PER IL TUO HARDWARE
                              </span>
                            )}
                            {downloadedModels.includes(m.modelName) && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 font-mono font-bold border border-cyan-800">
                                GIÀ INSTALLATO
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">{m.description}</p>
                        </div>
                      </div>
                      <span className="font-mono text-slate-400 text-xs shrink-0">{m.sizeBytesApprox}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* STEP 5: 👁️ Vision & 🧠 Embedding Selection */}
          {step === 5 && (
            <div className="space-y-6">
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                  👁️ Modello Vision & OCR Multimodale
                </h3>
                <div className="grid grid-cols-1 gap-2" role="radiogroup" aria-label="Seleziona modello Vision OCR">
                  {recommendations.visionTierModels.map((m) => {
                    const isSelected = selectedVision === m.modelName
                    return (
                      <div
                        key={m.modelName}
                        role="radio"
                        aria-checked={isSelected}
                        tabIndex={0}
                        onClick={() => setSelectedVision(m.modelName)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setSelectedVision(m.modelName)
                          }
                        }}
                        className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between text-xs transition-all focus-ring active:scale-[0.99] ${
                          isSelected
                            ? 'bg-amber-950/40 border-amber-500 shadow-md'
                            : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${isSelected ? 'border-amber-400 bg-amber-500' : 'border-slate-600'}`}>
                            {isSelected && <Check className="w-2.5 h-2.5 text-slate-950 font-bold" />}
                          </div>
                          <span className="font-semibold text-slate-200">{m.displayName}</span>
                          {isModelDownloaded(m.modelName) && (
                            <span className="text-[9px] px-1.5 py-0.5 bg-emerald-950 text-emerald-300 font-mono rounded">INSTALLATO</span>
                          )}
                        </div>
                        <span className="font-mono text-slate-400">{m.sizeBytesApprox}</span>
                      </div>
                    )
                  })}
                  {downloadedModels
                    .filter((dm) => !recommendations.visionTierModels.some((vm) => vm.modelName === dm || dm.startsWith(vm.modelName.split(':')[0])))
                    .map((dm) => {
                      const isSelected = selectedVision === dm
                      return (
                        <div
                          key={dm}
                          role="radio"
                          aria-checked={isSelected}
                          tabIndex={0}
                          onClick={() => setSelectedVision(dm)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setSelectedVision(dm)
                            }
                          }}
                          className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between text-xs transition-all focus-ring active:scale-[0.99] ${
                            isSelected
                              ? 'bg-amber-950/40 border-amber-500 shadow-md'
                              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${isSelected ? 'border-amber-400 bg-amber-500' : 'border-slate-600'}`}>
                              {isSelected && <Check className="w-2.5 h-2.5 text-slate-950 font-bold" />}
                            </div>
                            <span className="font-semibold text-slate-200">{dm}</span>
                            <span className="text-[9px] px-1.5 py-0.5 bg-emerald-950 text-emerald-300 font-mono rounded">INSTALLATO</span>
                          </div>
                          <span className="font-mono text-slate-400">Locale</span>
                        </div>
                      )
                    })}
                </div>
              </div>

              <div className="space-y-3 pt-3 border-t border-slate-800">
                <h3 className="text-sm font-bold text-purple-300 flex items-center gap-2">
                  🧠 Modello Vettoriale Vector Embedding (LanceDB)
                </h3>
                <div className="grid grid-cols-1 gap-2" role="radiogroup" aria-label="Seleziona modello Vector Embedding">
                  {recommendations.embeddingTierModels.map((m) => {
                    const isSelected = selectedEmbedding === m.modelName
                    return (
                      <div
                        key={m.modelName}
                        role="radio"
                        aria-checked={isSelected}
                        tabIndex={0}
                        onClick={() => setSelectedEmbedding(m.modelName)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setSelectedEmbedding(m.modelName)
                          }
                        }}
                        className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between text-xs transition-all focus-ring active:scale-[0.99] ${
                          isSelected
                            ? 'bg-purple-950/40 border-purple-500 shadow-md'
                            : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${isSelected ? 'border-purple-400 bg-purple-500' : 'border-slate-600'}`}>
                            {isSelected && <Check className="w-2.5 h-2.5 text-slate-950 font-bold" />}
                          </div>
                          <span className="font-semibold text-slate-200">{m.displayName}</span>
                          {isModelDownloaded(m.modelName) && (
                            <span className="text-[9px] px-1.5 py-0.5 bg-emerald-950 text-emerald-300 font-mono rounded">INSTALLATO</span>
                          )}
                        </div>
                        <span className="font-mono text-slate-400">{m.sizeBytesApprox}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* STEP 6: Summary, Strict Validation & Download */}
          {step === 6 && (
            <div className="space-y-6">
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-4">
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" /> Riepilogo Assegnazione dei 5 Livelli
                </h3>

                <div className="space-y-2 text-xs">
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex justify-between">
                    <span className="text-emerald-300 font-medium">🟢 Livello Fast:</span>
                    <span className="font-mono text-slate-200 font-semibold">{selectedFast || '❌ Non selezionato'}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex justify-between">
                    <span className="text-cyan-300 font-medium">🔵 Livello Standard:</span>
                    <span className="font-mono text-slate-200 font-semibold">{selectedStandard || '❌ Non selezionato'}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex justify-between">
                    <span className="text-purple-300 font-medium">🟣 Livello Deep Reasoning:</span>
                    <span className="font-mono text-slate-200 font-semibold">{selectedDeep || '❌ Non selezionato'}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex justify-between">
                    <span className="text-amber-300 font-medium">👁️ Modello Vision:</span>
                    <span className="font-mono text-slate-200 font-semibold">{selectedVision || '❌ Non selezionato'}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex justify-between">
                    <span className="text-purple-300 font-medium">🧠 Modello Vector Embedding:</span>
                    <span className="font-mono text-slate-200 font-semibold">{selectedEmbedding || '❌ Non selezionato'}</span>
                  </div>
                </div>
              </div>

              {/* Strict Validation & Disk Space Pre-Check Banner */}
              {!isAllSlotsPopulated ? (
                <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/80 text-xs text-rose-300 space-y-1">
                  <div className="flex items-center gap-2 font-bold text-sm">
                    <AlertTriangle className="w-5 h-5 text-rose-400" /> Assegnazione Incompleta
                  </div>
                  <p>
                    Non è possibile completare il wizard finché tutti e 5 i livelli non hanno un modello valido selezionato. Torna ai passaggi precedenti per selezionare un modello per ogni slot.
                  </p>
                </div>
              ) : missingModels.length > 0 ? (
                <div className="space-y-3">
                  <div className="p-4 rounded-xl bg-cyan-950/40 border border-cyan-800/80 text-xs text-cyan-300 space-y-2">
                    <div className="flex items-center gap-2 font-bold">
                      <Download className="w-4 h-4 text-cyan-400" /> {missingModels.length} Modelli da scaricare su Ollama
                    </div>
                    <p className="text-slate-300">
                      I seguenti modelli verranno scaricati automaticamente su Ollama al tuo OK:
                    </p>
                    <div className="font-mono text-[11px] bg-slate-950 p-2.5 rounded border border-cyan-900/60 text-slate-200 space-y-1">
                      {missingModels.map((m) => (
                        <div key={m}>• {m}</div>
                      ))}
                    </div>
                  </div>

                  {/* Disk Space Status Box */}
                  {isCheckingDisk ? (
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-400 flex items-center gap-2 font-mono">
                      <div className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" /> Verifico spazio libero su disco...
                    </div>
                  ) : diskCheck ? (
                    <div
                      className={`p-4 rounded-xl border text-xs space-y-2 ${
                        diskCheck.allowed
                          ? 'bg-emerald-950/30 border-emerald-800/80 text-emerald-300'
                          : 'bg-rose-950/40 border-rose-800/80 text-rose-300'
                      }`}
                    >
                      <div className="flex items-center justify-between font-bold">
                        <span className="flex items-center gap-2">
                          {diskCheck.allowed ? <ShieldCheck className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-rose-400" />}
                          Validazione Spazio Disco Pre-Download
                        </span>
                        <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
                          {diskCheck.freeGB} GB Liberi
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300">
                        Spazio stimato necessario: <strong className="font-mono">{diskCheck.requiredGB} GB</strong> (incluso buffer di sicurezza di 2 GB).
                      </p>
                      {!diskCheck.allowed && (
                        <div className="font-semibold text-rose-200 bg-rose-950/80 p-2 rounded border border-rose-700/60">
                          ⚠️ Spazio su disco insufficiente! Rimangono solo {diskCheck.freeGB} GB liberi su disco, ma occorrono {diskCheck.requiredGB} GB per completare il download. Libera almeno {diskCheck.missingGB} GB prima di proseguire.
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800/80 text-xs text-emerald-300 flex items-center gap-3 font-semibold">
                  <Check className="w-5 h-5 text-emerald-400" /> Tutti i modelli selezionati sono già scaricati e pronti all'uso su Ollama!
                </div>
              )}

              {/* Pull Error Notification & Recovery Box */}
              {pullErrorDetail && !isPullingModels && (
                <div className="p-4 rounded-xl bg-rose-950/50 border border-rose-700 text-xs text-rose-200 space-y-3 shadow-lg">
                  <div className="flex items-center gap-2 font-bold text-sm text-rose-300">
                    <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" /> Errore durante il Download
                  </div>
                  <p className="font-mono text-[11px] bg-slate-950 p-2.5 rounded border border-rose-900/60 text-rose-200">
                    {pullErrorDetail}
                  </p>
                  <p className="text-[11px] text-slate-300">
                    Puoi riprovare il download (assicurati che Ollama sia in esecuzione) oppure proseguire salvando la configurazione con i modelli già installati sul sistema.
                  </p>
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      onClick={handleStartBulkPull}
                      className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" /> Riprova Download
                    </button>
                    <button
                      onClick={handleFinalSave}
                      className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5 text-emerald-400" /> Salva con Modelli Presenti
                    </button>
                  </div>
                </div>
              )}

              {/* Progress Indicator */}
              {isPullingModels && (
                <div className="space-y-3 p-4 bg-slate-950 rounded-xl border border-slate-800 text-xs shadow-inner" role="status" aria-live="polite">
                  <div className="flex items-center justify-between text-slate-300 font-mono text-[11px]">
                    <span className="truncate pr-2">{pullingStatusText}</span>
                    <span className="shrink-0 font-bold text-cyan-400">{pullProgressPercent}%</span>
                  </div>
                  <div className="w-full bg-slate-900 h-2.5 rounded-full overflow-hidden border border-slate-800">
                    <div className="bg-gradient-to-r from-cyan-500 to-sky-400 h-full transition-all duration-300 rounded-full" style={{ width: `${pullProgressPercent}%` }} />
                  </div>
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={handleCancelPull}
                      className="px-3 py-1 bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all focus-ring active:scale-95"
                    >
                      <StopCircle className="w-3.5 h-3.5" /> Annulla Download
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Wizard Footer Navigation */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex items-center justify-between gap-3">
          <button
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1 || isPullingModels}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 disabled:opacity-40 text-slate-300 text-xs font-medium rounded-xl transition-all flex items-center gap-1.5"
          >
            <ChevronLeft className="w-4 h-4" /> Indietro
          </button>

          {step < 6 ? (
            <button
              onClick={() => setStep((s) => Math.min(6, s + 1))}
              className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5"
            >
              Avanti <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <div className="flex items-center gap-2">
              {missingModels.length > 0 && !isPullingModels && (
                <button
                  onClick={handleFinalSave}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-medium rounded-xl transition-all"
                  title="Salva la configurazione attuale senza scaricare nuovi modelli"
                >
                  Salta Download & Salva
                </button>
              )}
              <button
                onClick={handleStartBulkPull}
                disabled={!isAllSlotsPopulated || isPullingModels || (missingModels.length > 0 && !!diskCheck && !diskCheck.allowed)}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-slate-950 text-xs font-bold rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-emerald-950/50"
              >
                <Check className="w-4 h-4" /> {isPullingModels ? 'Download in corso...' : missingModels.length > 0 ? 'Conferma & Scarica Modelli' : 'Salva & Attiva Complexity Router'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
