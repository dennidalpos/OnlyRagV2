import React, { useState, useEffect, useRef, useCallback } from 'react'
import { AppSettings, DiagnosticsData, HardwareProfile } from '../../types'
import {
  analyzeHardwareAndRecommend,
  HardwareRecommendations,
  isOllamaModelInstalled,
} from '../../services/hardwareRecommendationEngine'
import {
  Cpu,
  ChevronRight,
  ChevronLeft,
  X,
  Check,
  Code,
  MessageSquare,
  Eye,
  Sliders,
  Download,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { WizardStepHardware } from '../wizard/WizardStepHardware'
import { WizardStepCodingTiers } from '../wizard/WizardStepCodingTiers'
import { WizardStepGeneralLlms } from '../wizard/WizardStepGeneralLlms'
import { WizardStepMultimodal } from '../wizard/WizardStepMultimodal'
import { WizardStepPreferences } from '../wizard/WizardStepPreferences'
import { WizardStepSummaryAndDownload } from '../wizard/WizardStepSummaryAndDownload'

interface HardwareSetupWizardModalProps {
  isOpen: boolean
  onClose: () => void
  diagnostics: DiagnosticsData | null
  settings: AppSettings
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void
  onRefreshDiagnostics: () => void
  isInitialSetup?: boolean
}

export const HardwareSetupWizardModal: React.FC<HardwareSetupWizardModalProps> = ({
  isOpen,
  onClose,
  diagnostics,
  settings,
  onUpdateSettings,
  onRefreshDiagnostics,
  isInitialSetup = false,
}) => {
  const { t } = useTranslation()
  const [step, setStep] = useState<number>(1)
  const recommendations: HardwareRecommendations = analyzeHardwareAndRecommend(diagnostics)

  // Derived directly from diagnostics so it reacts to onRefreshDiagnostics() without stale state
  const downloadedModels = diagnostics?.ollama.models ?? []

  const recFast =
    recommendations.fastTierModels.find((m) => m.isRecommended)?.modelName ||
    recommendations.fastTierModels[0].modelName
  const recStandard =
    recommendations.standardTierModels.find((m) => m.isRecommended)?.modelName ||
    recommendations.standardTierModels[0].modelName
  const recDeep =
    recommendations.deepReasoningTierModels.find((m) => m.isRecommended)?.modelName ||
    recommendations.deepReasoningTierModels[0].modelName
  const recChat =
    recommendations.chatTierModels.find((m) => m.isRecommended)?.modelName ||
    recommendations.chatTierModels[0].modelName
  const recTrans =
    recommendations.translationTierModels.find((m) => m.isRecommended)?.modelName ||
    recommendations.translationTierModels[0].modelName
  const recVision =
    recommendations.visionTierModels.find((m) => m.isRecommended)?.modelName ||
    recommendations.visionTierModels[0].modelName
  const recEmbedding =
    recommendations.embeddingTierModels.find((m) => m.isRecommended)?.modelName ||
    recommendations.embeddingTierModels[0].modelName

  // Model State across all Functional Slots
  // Pre-selection: prefer already saved settings, then recommended model. No substring guessing.
  const [selectedFast, setSelectedFast] = useState<string>(
    settings.complexityFastModel || recFast
  )
  const [selectedStandard, setSelectedStandard] = useState<string>(
    settings.complexityStandardModel ||
      settings.codingModel ||
      settings.defaultModel ||
      recStandard
  )
  const [selectedDeep, setSelectedDeep] = useState<string>(
    settings.complexityDeepModel || recDeep
  )
  const [selectedChat, setSelectedChat] = useState<string>(
    settings.chatModel || recChat
  )
  const [selectedTranslation, setSelectedTranslation] = useState<string>(
    settings.translationModel || recTrans
  )
  const [selectedMedical, setSelectedMedical] = useState<string>(
    settings.medicalModel || ''
  )
  const [selectedLegal, setSelectedLegal] = useState<string>(
    settings.legalModel || ''
  )
  const [selectedVision, setSelectedVision] = useState<string>(
    settings.visionModel || recVision
  )
  const [selectedEmbedding, setSelectedEmbedding] = useState<string>(
    settings.embeddingModel || recEmbedding
  )
  const [selectedHeavy, setSelectedHeavy] = useState<string>(
    settings.complexityHeavyModel || ''
  )

  // Runtime Preferences State
  const [useComplexityRouting, setUseComplexityRouting] = useState<boolean>(
    settings.useComplexityRouting !== false
  )
  const [hardwareProfile, setHardwareProfile] = useState<HardwareProfile>(
    settings.hardwareProfile || 'Auto'
  )
  const [ocrEngine, setOcrEngine] = useState<'native_cuda' | 'vision_model'>(
    settings.ocrEngine || 'native_cuda'
  )

  // Download & Installation Progress State
  const [isInstallingOllama, setIsInstallingOllama] = useState(false)
  const [isPullingModels, setIsPullingModels] = useState(false)
  const [pullingStatusText, setPullingStatusText] = useState('')
  const [pullProgressPercent, setPullProgressPercent] = useState(0)
  const [pullErrorDetail, setPullErrorDetail] = useState<string | null>(null)
  const [failedModelIndex, setFailedModelIndex] = useState<number | null>(null)
  const [skippedModels, setSkippedModels] = useState<string[]>([])
  const isCancelledRef = useRef<boolean>(false)

  // Disk Space Pre-Check State
  const [diskCheck, setDiskCheck] = useState<{
    allowed: boolean
    requiredGB: number
    freeGB: number
    missingGB: number
    error?: string
  } | null>(null)
  const [isCheckingDisk, setIsCheckingDisk] = useState(false)

  const prevIsOpenRef = useRef<boolean>(false)

  // Sync settings only when modal initially opens
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      if (settings.complexityFastModel) setSelectedFast(settings.complexityFastModel)
      if (settings.complexityStandardModel || settings.codingModel || settings.defaultModel) {
        setSelectedStandard(
          settings.complexityStandardModel || settings.codingModel || settings.defaultModel
        )
      }
      if (settings.complexityDeepModel) setSelectedDeep(settings.complexityDeepModel)
      setSelectedHeavy(settings.complexityHeavyModel || '')
      if (settings.chatModel) setSelectedChat(settings.chatModel)
      if (settings.translationModel) setSelectedTranslation(settings.translationModel)
      setSelectedMedical(settings.medicalModel || '')
      setSelectedLegal(settings.legalModel || '')
      if (settings.visionModel) setSelectedVision(settings.visionModel)
      if (settings.embeddingModel) setSelectedEmbedding(settings.embeddingModel)
      if (settings.hardwareProfile) setHardwareProfile(settings.hardwareProfile)
      if (settings.ocrEngine) setOcrEngine(settings.ocrEngine)
      setUseComplexityRouting(settings.useComplexityRouting !== false)
      setPullErrorDetail(null)
      setFailedModelIndex(null)
      setSkippedModels([])
      setIsPullingModels(false)
      isCancelledRef.current = false
      setStep(1)
    }
    prevIsOpenRef.current = isOpen
  }, [isOpen])

  const handleCloseWithSave = useCallback(() => {
    onUpdateSettings({
      defaultModel: selectedStandard || settings.defaultModel,
      useComplexityRouting,
      complexityFastModel: selectedFast || settings.complexityFastModel,
      complexityStandardModel: selectedStandard || settings.complexityStandardModel,
      complexityDeepModel: selectedDeep || settings.complexityDeepModel,
      complexityHeavyModel: selectedHeavy || settings.complexityHeavyModel,
      codingModel: selectedStandard || settings.codingModel,
      chatModel: selectedChat || settings.chatModel,
      translationModel: selectedTranslation || settings.translationModel,
      medicalModel: selectedMedical || settings.medicalModel,
      legalModel: selectedLegal || settings.legalModel,
      visionModel: selectedVision || settings.visionModel,
      embeddingModel: selectedEmbedding || settings.embeddingModel,
      hardwareProfile,
      ocrEngine,
      hasCompletedInitialSetup: true,
    })
    onClose()
  }, [
    onUpdateSettings,
    selectedStandard,
    settings,
    useComplexityRouting,
    selectedFast,
    selectedDeep,
    selectedHeavy,
    selectedChat,
    selectedTranslation,
    selectedMedical,
    selectedLegal,
    selectedVision,
    selectedEmbedding,
    hardwareProfile,
    ocrEngine,
    onClose,
  ])

  // ESC Key Listener for Accessibility
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPullingModels) {
        handleCloseWithSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isPullingModels, handleCloseWithSave])

  // Live Stream Progress Listener
  useEffect(() => {
    if (!window.electronAPI?.onOllamaPullProgress) return
    const unsub = window.electronAPI.onOllamaPullProgress((data) => {
      if (data.total && data.completed && data.total > 0) {
        const pct = Math.min(99, Math.round((data.completed / data.total) * 100))
        setPullProgressPercent(pct)
        const mbCompleted = (data.completed / (1024 * 1024)).toFixed(0)
        const mbTotal = (data.total / (1024 * 1024)).toFixed(0)
        setPullingStatusText(
          `Scaricamento [${data.modelName}]: ${data.status} (${mbCompleted}/${mbTotal} MB - ${pct}%)`
        )
      } else if (data.status) {
        setPullingStatusText(`[${data.modelName}]: ${data.status}`)
      }
    })
    return () => {
      unsub()
    }
  }, [])

  const isModelDownloaded = (modelName: string): boolean => {
    return isOllamaModelInstalled(modelName, downloadedModels)
  }

  // Calculate unique missing models (exclude empty heavy slot — it is optional)
  const uniqueSelectedModels = Array.from(
    new Set([
      selectedFast,
      selectedStandard,
      selectedDeep,
      // Heavy is optional: only include if explicitly assigned
      ...(selectedHeavy ? [selectedHeavy] : []),
      selectedChat,
      selectedTranslation,
      selectedMedical,
      selectedLegal,
      selectedVision,
      selectedEmbedding,
    ])
  ).filter((m) => !!m && m.trim().length > 0)

  const missingModels = uniqueSelectedModels
    .filter((m) => !isModelDownloaded(m.trim()))
    .filter((m) => !skippedModels.includes(m.trim()))

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

  if (!isOpen) return null

  const isAllSlotsPopulated =
    !!selectedFast.trim() &&
    !!selectedStandard.trim() &&
    !!selectedDeep.trim() &&
    !!selectedChat.trim() &&
    !!selectedTranslation.trim() &&
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
    setPullingStatusText(t('hardwareWizard.pullInterrupted'))
    if (window.electronAPI?.cancelPullOllamaModel) {
      try {
        await window.electronAPI.cancelPullOllamaModel()
      } catch (err) {
        console.error('Error cancelling Ollama pull:', err)
      }
    }
  }

  const handleStartBulkPull = async (startIndex: number = 0) => {
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
    setFailedModelIndex(null)
    let hasError = false

    for (let i = startIndex; i < missingModels.length; i++) {
      if (isCancelledRef.current) {
        hasError = true
        break
      }
      const modelToPull = missingModels[i]
      setPullingStatusText(
        `Connessione e download [${i + 1}/${missingModels.length}]: ${modelToPull}...`
      )
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
          const errDetail =
            res?.error || 'Download non completato. Verifica che Ollama sia attivo.'
          setFailedModelIndex(i)
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
        setFailedModelIndex(i)
        setPullErrorDetail(`Errore imprevisto per ${modelToPull}: ${errMsg}`)
        setPullingStatusText(`Errore [${modelToPull}]: ${errMsg}`)
        console.error(`Failed pulling ${modelToPull}:`, err)
        break
      }
    }

    if (!hasError && !isCancelledRef.current) {
      setPullProgressPercent(100)
      setPullingStatusText(t('hardwareWizard.allModelsPulled'))
      setIsPullingModels(false)
      handleFinalSave()
    } else {
      setIsPullingModels(false)
    }
  }

  const handleRetryPull = () => {
    setPullErrorDetail(null)
    handleStartBulkPull(failedModelIndex !== null ? failedModelIndex : 0)
  }

  const handleSkipCurrentPull = () => {
    if (failedModelIndex !== null && missingModels[failedModelIndex]) {
      const skipped = missingModels[failedModelIndex]
      setSkippedModels((prev) => [...prev, skipped])
      setPullErrorDetail(null)
      const nextIdx = failedModelIndex
      if (nextIdx < missingModels.length - 1) {
        handleStartBulkPull(nextIdx)
      } else {
        handleFinalSave()
      }
    } else {
      handleFinalSave()
    }
  }

  const handleAutoApplyRecommended = () => {
    setSelectedFast(recFast)
    setSelectedStandard(recStandard)
    setSelectedDeep(recDeep)
    setSelectedHeavy('')
    setSelectedChat(recChat)
    setSelectedTranslation(recTrans)
    setSelectedVision(recVision)
    setSelectedEmbedding(recEmbedding)
    setUseComplexityRouting(true)
    setHardwareProfile('Auto')
    setOcrEngine('native_cuda')
    setPullErrorDetail(null)
    setFailedModelIndex(null)
    setSkippedModels([])
    setDiskCheck(null)
    onUpdateSettings({
      defaultModel: recStandard,
      useComplexityRouting: true,
      complexityFastModel: recFast,
      complexityStandardModel: recStandard,
      complexityDeepModel: recDeep,
      complexityHeavyModel: '',
      codingModel: recStandard,
      chatModel: recChat,
      translationModel: recTrans,
      visionModel: recVision,
      embeddingModel: recEmbedding,
      hardwareProfile: 'Auto',
      ocrEngine: 'native_cuda',
      hasCompletedInitialSetup: true,
    })
    setStep(6)
  }

  const handleFinalSave = () => {
    onUpdateSettings({
      defaultModel: selectedStandard,
      useComplexityRouting,
      complexityFastModel: selectedFast,
      complexityStandardModel: selectedStandard,
      complexityDeepModel: selectedDeep,
      complexityHeavyModel: selectedHeavy || '',
      codingModel: selectedStandard,
      chatModel: selectedChat,
      translationModel: selectedTranslation,
      medicalModel: selectedMedical,
      legalModel: selectedLegal,
      visionModel: selectedVision,
      embeddingModel: selectedEmbedding,
      hardwareProfile,
      ocrEngine,
      hasCompletedInitialSetup: true,
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
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl flex flex-col shadow-2xl overflow-hidden max-h-[92vh]">
        {/* Wizard Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-sky-600 flex items-center justify-center border border-cyan-400/30">
              <Cpu className="w-5 h-5 text-slate-950 fill-current" />
            </div>
            <div>
              <h2
                id="wizard-modal-title"
                className="text-base font-bold text-slate-100 flex items-center gap-2"
              >
                {t('hardwareWizard.title')}{' '}
                <span className="text-cyan-400">— Step {step}/6</span>
              </h2>
              <p className="text-xs text-slate-400">
                {step === 1 && t('hardwareWizard.step1Subtitle')}
                {step === 2 && t('hardwareWizard.step2Subtitle')}
                {step === 3 && t('hardwareWizard.step3Subtitle')}
                {step === 4 && t('hardwareWizard.step4Subtitle')}
                {step === 5 && t('hardwareWizard.step5Subtitle')}
                {step === 6 && t('hardwareWizard.step6Subtitle')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCloseWithSave}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 text-xs font-semibold rounded-xl transition-colors focus-ring cursor-pointer"
              title="Salva le impostazioni configurate ed esci dal Wizard"
            >
              Salva & Esci
            </button>
            <button
              onClick={handleCloseWithSave}
              aria-label={t('common.close')}
              className="p-2 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-xl transition-colors focus-ring active:scale-95 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Interactive Step Navigation Bar (Stepper) */}
        <div className="bg-slate-950/90 border-b border-slate-800 px-4 py-2.5">
          <nav aria-label="Wizard Steps" className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
            {[
              { id: 1, label: '1. Hardware', icon: Cpu, desc: 'Rilevamento Hardware' },
              { id: 2, label: '2. Coding', icon: Code, desc: 'AI Coding Agent' },
              { id: 3, label: '3. Chat & LLM', icon: MessageSquare, desc: 'RAG & Traduzione' },
              { id: 4, label: '4. Multimodale', icon: Eye, desc: 'Vision OCR & Embedding' },
              { id: 5, label: '5. Preferenze', icon: Sliders, desc: 'Profilo & Runtime' },
              { id: 6, label: '6. Download', icon: Download, desc: 'Riepilogo & Pull' },
            ].map((st) => {
              const isCurrent = step === st.id
              const isCompleted = step > st.id
              const Icon = st.icon
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => {
                    if (!isPullingModels) setStep(st.id)
                  }}
                  disabled={isPullingModels}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={`px-2 py-1.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer select-none focus-ring ${
                    isCurrent
                      ? 'bg-cyan-950/90 text-cyan-300 border-cyan-500 shadow-md shadow-cyan-950/40 ring-1 ring-cyan-400/40'
                      : isCompleted
                      ? 'bg-slate-900/80 text-emerald-300/90 border-emerald-800/40 hover:bg-slate-850 hover:text-emerald-200'
                      : 'bg-slate-900/40 text-slate-400 border-slate-800/80 hover:bg-slate-800/70 hover:text-slate-200 hover:border-slate-700'
                  }`}
                  title={`${st.desc} — Clicca per andare allo step ${st.id}`}
                >
                  <div
                    className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 font-bold ${
                      isCurrent
                        ? 'bg-cyan-400 text-slate-950 font-black'
                        : isCompleted
                        ? 'bg-emerald-500 text-slate-950 font-black'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {isCompleted ? <Check className="w-2.5 h-2.5 stroke-[3]" /> : st.id}
                  </div>
                  <span className="truncate">{st.label}</span>
                </button>
              )
            })}
          </nav>
        </div>

        {/* Wizard Step Content */}
        <div className="p-6 overflow-y-auto flex-1 relative">
          {step === 1 && (
            <WizardStepHardware
              diagnostics={diagnostics}
              recommendations={recommendations}
              downloadedModels={downloadedModels}
              isInstallingOllama={isInstallingOllama}
              isInitialSetup={isInitialSetup}
              onLaunchOrInstallOllama={handleLaunchOrInstallOllama}
              onAutoApply={handleAutoApplyRecommended}
            />
          )}

          {step === 2 && (
            <WizardStepCodingTiers
              useComplexityRouting={useComplexityRouting}
              onToggleComplexityRouting={setUseComplexityRouting}
              selectedFast={selectedFast}
              onSelectFast={setSelectedFast}
              selectedStandard={selectedStandard}
              onSelectStandard={setSelectedStandard}
              selectedDeep={selectedDeep}
              onSelectDeep={setSelectedDeep}
              selectedHeavy={selectedHeavy}
              onSelectHeavy={setSelectedHeavy}
              fastTierModels={recommendations.fastTierModels}
              standardTierModels={recommendations.standardTierModels}
              deepReasoningTierModels={recommendations.deepReasoningTierModels}
              heavyEscalationTierModels={recommendations.heavyEscalationTierModels}
              downloadedModels={downloadedModels}
              isModelDownloaded={isModelDownloaded}
            />
          )}

          {step === 3 && (
            <WizardStepGeneralLlms
              selectedChat={selectedChat}
              onSelectChat={setSelectedChat}
              selectedTranslation={selectedTranslation}
              onSelectTranslation={setSelectedTranslation}
              selectedMedical={selectedMedical}
              onSelectMedical={setSelectedMedical}
              selectedLegal={selectedLegal}
              onSelectLegal={setSelectedLegal}
              chatTierModels={recommendations.chatTierModels}
              translationTierModels={recommendations.translationTierModels}
              medicalTierModels={recommendations.medicalTierModels}
              legalTierModels={recommendations.legalTierModels}
              downloadedModels={downloadedModels}
              isModelDownloaded={isModelDownloaded}
            />
          )}

          {step === 4 && (
            <WizardStepMultimodal
              selectedVision={selectedVision}
              onSelectVision={setSelectedVision}
              selectedEmbedding={selectedEmbedding}
              onSelectEmbedding={setSelectedEmbedding}
              visionTierModels={recommendations.visionTierModels}
              embeddingTierModels={recommendations.embeddingTierModels}
              downloadedModels={downloadedModels}
              isModelDownloaded={isModelDownloaded}
            />
          )}

          {step === 5 && (
            <WizardStepPreferences
              hardwareProfile={hardwareProfile}
              onSelectHardwareProfile={setHardwareProfile}
              ocrEngine={ocrEngine}
              onSelectOcrEngine={setOcrEngine}
              maxConcurrentTasks={settings.maxConcurrentTasks || 1}
              onChangeMaxConcurrentTasks={(val) => onUpdateSettings({ maxConcurrentTasks: val })}
            />
          )}

          {step === 6 && (
            <WizardStepSummaryAndDownload
              selectedFast={selectedFast}
              selectedStandard={selectedStandard}
              selectedDeep={selectedDeep}
              selectedHeavy={selectedHeavy}
              selectedChat={selectedChat}
              selectedTranslation={selectedTranslation}
              selectedMedical={selectedMedical}
              selectedLegal={selectedLegal}
              selectedVision={selectedVision}
              selectedEmbedding={selectedEmbedding}
              useComplexityRouting={useComplexityRouting}
              hardwareProfile={hardwareProfile}
              ocrEngine={ocrEngine}
              isAllSlotsPopulated={isAllSlotsPopulated}
              missingModels={missingModels}
              isCheckingDisk={isCheckingDisk}
              diskCheck={diskCheck}
              isPullingModels={isPullingModels}
              pullingStatusText={pullingStatusText}
              pullProgressPercent={pullProgressPercent}
              pullErrorDetail={pullErrorDetail}
              onCancelPull={handleCancelPull}
              onRetryPull={handleRetryPull}
              onSkipCurrentPull={handleSkipCurrentPull}
              onFinishWithoutMissing={handleFinalSave}
            />
          )}
        </div>

        {/* Wizard Footer Navigation */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex items-center justify-between gap-3">
          <button
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1 || isPullingModels}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 disabled:opacity-40 text-slate-300 text-xs font-medium rounded-xl transition-all flex items-center gap-1.5 focus-ring"
          >
            <ChevronLeft className="w-4 h-4" /> {t('hardwareWizard.backBtn')}
          </button>

          {step < 6 ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handleCloseWithSave}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 focus-ring"
                title="Salva le impostazioni configurate finora ed esci"
              >
                <Check className="w-3.5 h-3.5 text-emerald-400" /> Salva ed Esci
              </button>
              <button
                onClick={() => setStep((s) => Math.min(6, s + 1))}
                className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 focus-ring shadow-md shadow-cyan-950/40 active:scale-95"
              >
                {t('hardwareWizard.nextBtn')} <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {missingModels.length > 0 && !isPullingModels && (
                <button
                  onClick={handleFinalSave}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-medium rounded-xl transition-all focus-ring"
                  title="Save configuration and skip download"
                >
                  {t('hardwareWizard.skipDownloadBtn')}
                </button>
              )}
              <button
                onClick={() => handleStartBulkPull()}
                disabled={
                  !isAllSlotsPopulated ||
                  isPullingModels ||
                  (missingModels.length > 0 && !!diskCheck && !diskCheck.allowed)
                }
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-slate-950 text-xs font-bold rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-emerald-950/50 focus-ring active:scale-95"
              >
                <Check className="w-4 h-4" />{' '}
                {isPullingModels
                  ? `${t('common.loading')}...`
                  : missingModels.length > 0
                  ? t('hardwareWizard.confirmDownloadBtn')
                  : t('hardwareWizard.finishBtn')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
