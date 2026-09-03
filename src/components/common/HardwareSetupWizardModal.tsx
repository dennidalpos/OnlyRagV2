import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Modal } from './Modal'
import { AppSettings, DiagnosticsData } from '../../types'
import {
  analyzeHardwareAndRecommend,
  buildModelFitLookup,
  HardwareRecommendations,
  isOllamaModelInstalled,
} from '../../services/hardwareRecommendationEngine'
import {
  Cpu,
  ChevronRight,
  ChevronLeft,
  X,
  Check,
  Sparkles,
  Download,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { WizardStepHardware } from '../wizard/WizardStepHardware'
import { WizardStepRecommendedModels } from '../wizard/WizardStepRecommendedModels'
import { WizardStepSummaryAndDownload } from '../wizard/WizardStepSummaryAndDownload'
import { logger } from '../../lib/logger'
import { selectWizardCodingSet } from '../../services/codingModelMatrix'
import { buildCodingCatalogForWizard } from '../../../shared/domain/hardware/hardwareModelCatalog'

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
  const enableSoundEffects = settings.enableSoundEffects !== false
  const recommendations: HardwareRecommendations = analyzeHardwareAndRecommend(
    diagnostics,
  )
  // Assesses any model tag against the host, including preset options absent from the catalogs.
  const getModelFit = buildModelFitLookup(diagnostics)

  const downloadedModels = diagnostics?.ollama.models ?? []

  const recCoding =
    recommendations.codingModels.find((m) => m.isRecommended)?.modelName ||
    recommendations.codingModels[0]?.modelName ||
    'qwen2.5-coder:7b'
  const recChat =
    recommendations.chatTierModels.find((m) => m.isRecommended)?.modelName ||
    recommendations.chatTierModels[0]?.modelName ||
    'llama3.1:8b'
  const recTrans =
    recommendations.translationTierModels.find((m) => m.isRecommended)?.modelName ||
    recommendations.translationTierModels[0]?.modelName ||
    'qwen2.5:7b'
  const recVision =
    recommendations.visionTierModels.find((m) => m.isRecommended)?.modelName ||
    recommendations.visionTierModels[0]?.modelName ||
    'llama3.2-vision:11b'
  const recEmbedding =
    recommendations.embeddingTierModels.find((m) => m.isRecommended)?.modelName ||
    recommendations.embeddingTierModels[0]?.modelName ||
    'nomic-embed-text'

  /**
   * The one-click coding set for the detected hardware tier.
   *
   * `recCoding` above answers "what fits this GPU". This answers the question a user actually
   * has on first launch — "which of these has anyone checked?" — by putting the models this app
   * has been RUN against ahead of the ones it merely catalogs. See codingModelMatrix.ts, and
   * note the list there is short because it is evidence-backed rather than aspirational.
   *
   * Empty when nothing in the catalog fits the tier, which the step renders as such: a wizard
   * that installs a model too large for the machine has done the user real harm.
   */
  const verifiedCodingSet = selectWizardCodingSet(
    buildCodingCatalogForWizard(),
    recommendations.profileTier
  ).map((entry) => entry.modelName)

  // Model State across all Functional Slots
  const [selectedCoding, setSelectedCoding] = useState<string>(
    settings.codingModel || settings.defaultModel || recCoding
  )
  const [selectedCodingFallback, setSelectedCodingFallback] = useState<string | undefined>(
    settings.codingFallbackModel
  )
  const [selectedChat, setSelectedChat] = useState<string>(
    settings.chatModel || recChat
  )
  const [selectedChatFallback, setSelectedChatFallback] = useState<string | undefined>(
    settings.chatFallbackModel
  )
  const [selectedTranslation, setSelectedTranslation] = useState<string>(
    settings.translationModel || recTrans
  )
  const [selectedTranslationFallback, setSelectedTranslationFallback] = useState<string | undefined>(
    settings.translationFallbackModel
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

  // Runtime Preferences State
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
      if (settings.codingModel || settings.defaultModel) {
        setSelectedCoding(
          settings.codingModel || settings.defaultModel
        )
      }
      setSelectedCodingFallback(settings.codingFallbackModel)
      if (settings.chatModel) setSelectedChat(settings.chatModel)
      setSelectedChatFallback(settings.chatFallbackModel)
      if (settings.translationModel) setSelectedTranslation(settings.translationModel)
      setSelectedTranslationFallback(settings.translationFallbackModel)
      setSelectedMedical(settings.medicalModel || '')
      setSelectedLegal(settings.legalModel || '')
      if (settings.visionModel) setSelectedVision(settings.visionModel)
      if (settings.embeddingModel) setSelectedEmbedding(settings.embeddingModel)
      if (settings.ocrEngine) setOcrEngine(settings.ocrEngine)
      setPullErrorDetail(null)
      setFailedModelIndex(null)
      setSkippedModels([])
      setIsPullingModels(false)
      isCancelledRef.current = false
      setStep(1)
    }
    prevIsOpenRef.current = isOpen
  }, [isOpen, settings])

  const handleCloseWithSave = useCallback(() => {
    onUpdateSettings({
      defaultModel: selectedCoding || settings.defaultModel,
      codingModel: selectedCoding || settings.codingModel,
      codingFallbackModel: selectedCodingFallback,
      chatModel: selectedChat || settings.chatModel,
      chatFallbackModel: selectedChatFallback,
      translationModel: selectedTranslation || settings.translationModel,
      translationFallbackModel: selectedTranslationFallback,
      medicalModel: selectedMedical || settings.medicalModel,
      legalModel: selectedLegal || settings.legalModel,
      visionModel: selectedVision || settings.visionModel,
      embeddingModel: selectedEmbedding || settings.embeddingModel,
      ocrEngine,
      enableSoundEffects,
      hasCompletedInitialSetup: true,
    })
    onClose()
  }, [
    onUpdateSettings,
    selectedCoding,
    selectedCodingFallback,
    selectedChat,
    selectedChatFallback,
    selectedTranslation,
    selectedTranslationFallback,
    selectedMedical,
    selectedLegal,
    selectedVision,
    selectedEmbedding,
    ocrEngine,
    enableSoundEffects,
    settings,
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
          t('hardwareWizard.pullingProgressStatus', {
            model: data.modelName,
            status: data.status,
            completed: mbCompleted,
            total: mbTotal,
            percent: pct,
          })
        )
      } else if (data.status) {
        setPullingStatusText(t('hardwareWizard.pullingModelStatus', { model: data.modelName, status: data.status }))
      }
    })
    return () => {
      unsub()
    }
  }, [t])

  const isModelDownloaded = (modelName: string): boolean => {
    return isOllamaModelInstalled(modelName, downloadedModels)
  }

  // Calculate unique missing models
  const uniqueSelectedModels = Array.from(
    new Set([
      selectedCoding,
      ...(selectedCodingFallback ? [selectedCodingFallback] : []),
      selectedChat,
      ...(selectedChatFallback ? [selectedChatFallback] : []),
      selectedTranslation,
      ...(selectedTranslationFallback ? [selectedTranslationFallback] : []),
      selectedMedical,
      selectedLegal,
      selectedVision,
      selectedEmbedding,
    ])
  ).filter((m): m is string => Boolean(m && typeof m === 'string' && m.trim().length > 0))

  const missingModels = uniqueSelectedModels
    .filter((m) => !isModelDownloaded(m.trim()))
    .filter((m) => !skippedModels.includes(m.trim()))

  // Check Disk Space when entering Step 3 (Summary & Download)
  useEffect(() => {
    if (step === 3 && missingModels.length > 0 && window.electronAPI?.checkDiskSpace) {
      setIsCheckingDisk(true)
      window.electronAPI
        .checkDiskSpace(missingModels)
        .then((res) => {
          setDiskCheck(res)
          setIsCheckingDisk(false)
        })
        .catch((err) => {
          logger.error('HardwareWizard', `Disk space check failed: ${err?.message || err}`)
          setIsCheckingDisk(false)
        })
    }
  }, [step, missingModels.join(',')])

  if (!isOpen) return null

  const isAllSlotsPopulated =
    Boolean(selectedCoding.trim()) &&
    Boolean(selectedChat.trim()) &&
    Boolean(selectedTranslation.trim()) &&
    Boolean(selectedVision.trim()) &&
    Boolean(selectedEmbedding.trim())

  const handleLaunchOrInstallOllama = async () => {
    if (!window.electronAPI?.installOrLaunchOllama) return
    setIsInstallingOllama(true)
    try {
      await window.electronAPI.installOrLaunchOllama()
      onRefreshDiagnostics()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('HardwareWizard', `Failed launching/installing Ollama: ${msg}`)
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
        const msg = err instanceof Error ? err.message : String(err)
        logger.error('HardwareWizard', `Error cancelling Ollama pull: ${msg}`)
      }
    }
  }

  const handleStartBulkPull = async (startIndex: number = 0) => {
    if (!window.electronAPI || missingModels.length === 0) {
      handleFinalSave()
      return
    }

    if (diskCheck && !diskCheck.allowed) {
      // Reported through the wizard's own error channel rather than a blocking native alert:
      // the message stays inside the dialog the user is looking at, in the app's own styling.
      setPullErrorDetail(
        t('hardwareWizard.insufficientDiskSpaceAlert', {
          free: diskCheck.freeGB,
          required: diskCheck.requiredGB,
          missing: diskCheck.missingGB,
        })
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
        t('hardwareWizard.connectingAndDownloadingStatus', {
          current: i + 1,
          total: missingModels.length,
          model: modelToPull,
        })
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
          const errDetail = res?.error || t('hardwareWizard.downloadFailedGeneric')
          setFailedModelIndex(i)
          setPullErrorDetail(t('hardwareWizard.downloadErrorForModel', { model: modelToPull, detail: errDetail }))
          setPullingStatusText(t('hardwareWizard.downloadErrorStatus', { model: modelToPull, detail: errDetail }))
          logger.error('HardwareWizard', `Failed pulling ${modelToPull}: ${errDetail}`)
          break
        }
      } catch (err: any) {
        if (isCancelledRef.current) {
          hasError = true
          break
        }
        hasError = true
        const errMsg = err?.message || t('hardwareWizard.unexpectedDownloadError')
        setFailedModelIndex(i)
        setPullErrorDetail(t('hardwareWizard.unexpectedErrorForModel', { model: modelToPull, detail: errMsg }))
        setPullingStatusText(t('hardwareWizard.downloadErrorStatus', { model: modelToPull, detail: errMsg }))
        logger.error('HardwareWizard', `Failed pulling ${modelToPull}: ${errMsg}`)
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
    setSelectedCoding(recCoding)
    setSelectedChat(recChat)
    setSelectedTranslation(recTrans)
    setSelectedVision(recVision)
    setSelectedEmbedding(recEmbedding)
    setOcrEngine('native_cuda')
    setPullErrorDetail(null)
    setFailedModelIndex(null)
    setSkippedModels([])
    setDiskCheck(null)
    onUpdateSettings({
      defaultModel: recCoding,
      codingModel: recCoding,
      chatModel: recChat,
      translationModel: recTrans,
      visionModel: recVision,
      embeddingModel: recEmbedding,
      ocrEngine: 'native_cuda',
      enableSoundEffects,
      hasCompletedInitialSetup: true,
    })
    setStep(3)
  }

  const handleFinalSave = () => {
    onUpdateSettings({
      defaultModel: selectedCoding,
      codingModel: selectedCoding,
      codingFallbackModel: selectedCodingFallback,
      chatModel: selectedChat,
      chatFallbackModel: selectedChatFallback,
      translationModel: selectedTranslation,
      translationFallbackModel: selectedTranslationFallback,
      medicalModel: selectedMedical,
      legalModel: selectedLegal,
      visionModel: selectedVision,
      embeddingModel: selectedEmbedding,
      ocrEngine,
      enableSoundEffects,
      hasCompletedInitialSetup: true,
    })
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      labelledById="wizard-modal-title"
      panelClassName="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-3xl max-h-[92vh] flex flex-col overflow-hidden"
    >
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
                <span className="text-cyan-400">— Step {step} di 3</span>
              </h2>
              <p className="text-xs text-slate-400">
                {step === 1 && 'Scansione profilo hardware e stato del runtime Ollama'}
                {step === 2 && 'Selezione della suite di modelli raccomandata (Workhorse & Fallback)'}
                {step === 3 && 'Riepilogo finale e download batch dei modelli mancanti'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCloseWithSave}
              aria-label={t('hardwareWizard.saveAndExit')}
              title={t('hardwareWizard.saveAndExitTooltip')}
              className="p-2 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-xl transition-colors focus-ring active:scale-95 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 3-Step Stepper Navigation */}
        <div className="bg-slate-950/90 border-b border-slate-800 px-4 py-2.5">
          <nav aria-label="Wizard Steps" className="grid grid-cols-3 gap-2">
            {[
              { id: 1, label: '1. Scansione Hardware', icon: Cpu, desc: 'Rilevamento GPU e RAM' },
              { id: 2, label: '2. Modelli Consigliati', icon: Sparkles, desc: 'Suite Workhorse & Fallback' },
              { id: 3, label: '3. Download & Avvio', icon: Download, desc: 'Riepilogo e Setup' },
            ].map((st) => {
              const isCurrent = step === st.id
              const isCompleted = step > st.id
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => {
                    if (!isPullingModels) setStep(st.id)
                  }}
                  disabled={isPullingModels}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer select-none focus-ring ${
                    isCurrent
                      ? 'bg-cyan-950/90 text-cyan-300 border-cyan-500 shadow-md shadow-cyan-950/40 ring-1 ring-cyan-400/40'
                      : isCompleted
                      ? 'bg-slate-900/80 text-emerald-300/90 border-emerald-800/40 hover:bg-slate-850 hover:text-emerald-200'
                      : 'bg-slate-900/40 text-slate-400 border-slate-800/80 hover:bg-slate-800/70 hover:text-slate-200 hover:border-slate-700'
                  }`}
                  title={st.desc}
                >
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0 font-bold ${
                      isCurrent
                        ? 'bg-cyan-400 text-slate-950 font-black'
                        : isCompleted
                        ? 'bg-emerald-500 text-slate-950 font-black'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {isCompleted ? <Check className="w-3 h-3 stroke-[3]" /> : st.id}
                  </div>
                  <span className="truncate">{st.label}</span>
                </button>
              )
            })}
          </nav>
        </div>

        {/* Modal Main Body */}
        <div className="p-5 flex-1 overflow-y-auto">
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
            <WizardStepRecommendedModels
              downloadedModels={downloadedModels}
              getModelFit={getModelFit}
              selectedCoding={selectedCoding}
              selectedCodingFallback={selectedCodingFallback}
              onChangeCoding={setSelectedCoding}
              onChangeCodingFallback={setSelectedCodingFallback}
              verifiedCodingSet={verifiedCodingSet}
              onApplyVerifiedSet={() => {
                if (verifiedCodingSet[0]) setSelectedCoding(verifiedCodingSet[0])
                if (verifiedCodingSet[1]) setSelectedCodingFallback(verifiedCodingSet[1])
              }}
              codingPresetOptions={[
                'qwen2.5-coder:7b',
                'qwen3:8b',
                'qwen2.5-coder:14b',
                'qwen3:14b',
                'gpt-oss:20b',
                'codestral:22b',
                'qwen2.5-coder:32b',
                'deepseek-coder:6.7b',
                'llama3.1:8b',
              ]}
              selectedChat={selectedChat}
              selectedChatFallback={selectedChatFallback}
              onChangeChat={setSelectedChat}
              onChangeChatFallback={setSelectedChatFallback}
              chatPresetOptions={['llama3.1:8b', 'llama3.2:3b', 'qwen2.5:7b', 'mistral:7b', 'gemma2:9b']}
              selectedTranslation={selectedTranslation}
              selectedTranslationFallback={selectedTranslationFallback}
              onChangeTranslation={setSelectedTranslation}
              onChangeTranslationFallback={setSelectedTranslationFallback}
              translationPresetOptions={['qwen2.5:7b', 'llama3.1:8b', 'aya-expanse:8b', 'gemma2:2b', 'gemma2:9b']}
              selectedVision={selectedVision}
              onChangeVision={setSelectedVision}
              visionPresetOptions={['llama3.2-vision:11b', 'llama3.2-vision:latest', 'minicpm-v:8b', 'llava:7b']}
              selectedEmbedding={selectedEmbedding}
              onChangeEmbedding={setSelectedEmbedding}
              embeddingPresetOptions={['nomic-embed-text', 'bge-m3', 'bge-large', 'all-minilm']}
              selectedMedical={selectedMedical}
              onChangeMedical={(m) => setSelectedMedical(m || '')}
              medicalPresetOptions={['adrienbrault/biomistral-7b:Q4_K_M', 'meditron:7b']}
              selectedLegal={selectedLegal}
              onChangeLegal={(m) => setSelectedLegal(m || '')}
              legalPresetOptions={['llama3.1:8b', 'mistral:7b', 'command-r:35b']}
            />
          )}

          {step === 3 && (
            <WizardStepSummaryAndDownload
              selectedCoding={selectedCoding}
              selectedCodingFallback={selectedCodingFallback}
              selectedChat={selectedChat}
              selectedChatFallback={selectedChatFallback}
              selectedTranslation={selectedTranslation}
              selectedTranslationFallback={selectedTranslationFallback}
              selectedMedical={selectedMedical}
              selectedLegal={selectedLegal}
              selectedVision={selectedVision}
              selectedEmbedding={selectedEmbedding}
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

        {/* Modal Footer Controls */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between">
          <div>
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                disabled={isPullingModels}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl transition-all border border-slate-800 flex items-center gap-1.5 focus-ring active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" /> {t('common.back')}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCloseWithSave}
              disabled={isPullingModels}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs font-medium rounded-xl transition-all border border-slate-800 focus-ring active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {t('hardwareWizard.saveAndExit')}
            </button>

            {step < 3 ? (
              <button
                type="button"
                onClick={() => setStep((s) => s + 1)}
                className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 focus-ring shadow-lg shadow-cyan-950/40 active:scale-95 cursor-pointer"
              >
                {t('common.next')} <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (missingModels.length > 0) {
                    handleStartBulkPull(0)
                  } else {
                    handleFinalSave()
                  }
                }}
                disabled={isPullingModels || !isAllSlotsPopulated}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 focus-ring shadow-lg shadow-emerald-950/40 active:scale-95 disabled:cursor-not-allowed cursor-pointer"
              >
                {isPullingModels ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                    <span>{t('hardwareWizard.installingOllama')}</span>
                  </>
                ) : missingModels.length > 0 ? (
                  <>
                    <Download className="w-4 h-4" />
                    <span>{t('hardwareWizard.confirmDownloadBtn')}</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>{t('hardwareWizard.finishBtn')}</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
    </Modal>
  )
}
