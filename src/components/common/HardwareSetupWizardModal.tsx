import React, { useState, useEffect, useRef } from 'react'
import { AppSettings, DiagnosticsData, HardwareProfile } from '../../types'
import {
  analyzeHardwareAndRecommend,
  HardwareRecommendations,
} from '../../services/hardwareRecommendationEngine'
import { Cpu, ChevronRight, ChevronLeft, X, Check } from 'lucide-react'
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

  const downloadedModels = diagnostics?.ollama.models || []

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
  const [selectedFast, setSelectedFast] = useState<string>(
    settings.complexityFastModel ||
      (downloadedModels.includes(recFast)
        ? recFast
        : downloadedModels.find((m) => m.includes('3b') || m.includes('1.5b')) || recFast)
  )
  const [selectedStandard, setSelectedStandard] = useState<string>(
    settings.complexityStandardModel ||
      settings.codingModel ||
      settings.defaultModel ||
      (downloadedModels.includes(recStandard)
        ? recStandard
        : downloadedModels.find((m) => m.includes('7b') || m.includes('8b')) || recStandard)
  )
  const [selectedDeep, setSelectedDeep] = useState<string>(
    settings.complexityDeepModel ||
      (downloadedModels.includes(recDeep)
        ? recDeep
        : downloadedModels.find((m) => m.includes('8b') && m.includes('r1')) || recDeep)
  )
  const [selectedChat, setSelectedChat] = useState<string>(
    settings.chatModel ||
      (downloadedModels.includes(recChat)
        ? recChat
        : downloadedModels.find((m) => m.includes('llama3.1') || m.includes('mistral')) || recChat)
  )
  const [selectedTranslation, setSelectedTranslation] = useState<string>(
    settings.translationModel ||
      (downloadedModels.includes(recTrans)
        ? recTrans
        : downloadedModels.find((m) => m.includes('qwen2.5') && !m.includes('coder')) || recTrans)
  )
  const [selectedVision, setSelectedVision] = useState<string>(
    settings.visionModel ||
      (downloadedModels.includes(recVision)
        ? recVision
        : downloadedModels.find(
            (m) =>
              m.includes('vision') ||
              m.includes('vl') ||
              m.includes('minicpm') ||
              m.includes('llava') ||
              m.includes('moondream')
          ) || recVision)
  )
  const [selectedEmbedding, setSelectedEmbedding] = useState<string>(
    settings.embeddingModel ||
      (downloadedModels.includes(recEmbedding)
        ? recEmbedding
        : downloadedModels.find((m) => m.includes('embed') || m.includes('nomic')) || recEmbedding)
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

  // Sync settings when modal opens
  useEffect(() => {
    if (isOpen) {
      if (settings.complexityFastModel) setSelectedFast(settings.complexityFastModel)
      if (settings.complexityStandardModel || settings.codingModel || settings.defaultModel) {
        setSelectedStandard(
          settings.complexityStandardModel || settings.codingModel || settings.defaultModel
        )
      }
      if (settings.complexityDeepModel) setSelectedDeep(settings.complexityDeepModel)
      if (settings.chatModel) setSelectedChat(settings.chatModel)
      if (settings.translationModel) setSelectedTranslation(settings.translationModel)
      if (settings.visionModel) setSelectedVision(settings.visionModel)
      if (settings.embeddingModel) setSelectedEmbedding(settings.embeddingModel)
      if (settings.hardwareProfile) setHardwareProfile(settings.hardwareProfile)
      if (settings.ocrEngine) setOcrEngine(settings.ocrEngine)
      setUseComplexityRouting(settings.useComplexityRouting !== false)
      setPullErrorDetail(null)
      setIsPullingModels(false)
      isCancelledRef.current = false
      setStep(1)
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
    if (!modelName) return false
    const clean = modelName.trim().toLowerCase()
    const base = clean.split(':')[0]
    return downloadedModels.some((d) => {
      const dClean = d.toLowerCase().trim()
      return (
        dClean === clean ||
        dClean === `${clean}:latest` ||
        `${dClean}:latest` === clean ||
        dClean.split(':')[0] === base
      )
    })
  }

  // Calculate unique missing models
  const uniqueSelectedModels = Array.from(
    new Set([
      selectedFast,
      selectedStandard,
      selectedDeep,
      selectedChat,
      selectedTranslation,
      selectedVision,
      selectedEmbedding,
    ])
  ).filter((m) => !!m && m.trim().length > 0)

  const missingModels = uniqueSelectedModels.filter((m) => !isModelDownloaded(m.trim()))

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
      setPullingStatusText(t('hardwareWizard.allModelsPulled'))
      setIsPullingModels(false)
      handleFinalSave()
    } else {
      setIsPullingModels(false)
    }
  }

  const handleAutoApplyRecommended = () => {
    setSelectedFast(recFast)
    setSelectedStandard(recStandard)
    setSelectedDeep(recDeep)
    setSelectedChat(recChat)
    setSelectedTranslation(recTrans)
    setSelectedVision(recVision)
    setSelectedEmbedding(recEmbedding)
    setUseComplexityRouting(true)
    setHardwareProfile('Auto')
    setOcrEngine('native_cuda')
    setStep(6)
  }

  const handleFinalSave = () => {
    onUpdateSettings({
      defaultModel: selectedStandard,
      useComplexityRouting,
      complexityFastModel: selectedFast,
      complexityStandardModel: selectedStandard,
      complexityDeepModel: selectedDeep,
      codingModel: selectedStandard,
      chatModel: selectedChat,
      translationModel: selectedTranslation,
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
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
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

          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-2 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-xl transition-colors focus-ring active:scale-95"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Wizard Step Content */}
        <div className="p-6 overflow-y-auto flex-1">
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
              fastTierModels={recommendations.fastTierModels}
              standardTierModels={recommendations.standardTierModels}
              deepReasoningTierModels={recommendations.deepReasoningTierModels}
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
              chatTierModels={recommendations.chatTierModels}
              translationTierModels={recommendations.translationTierModels}
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
              selectedChat={selectedChat}
              selectedTranslation={selectedTranslation}
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
            <button
              onClick={() => setStep((s) => Math.min(6, s + 1))}
              className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 focus-ring shadow-md shadow-cyan-950/40 active:scale-95"
            >
              {t('hardwareWizard.nextBtn')} <ChevronRight className="w-4 h-4" />
            </button>
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
                onClick={handleStartBulkPull}
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
