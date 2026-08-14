import React from 'react'
import { ShieldCheck, AlertTriangle, Download, Check, StopCircle, HardDrive } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { HardwareProfile } from '../../types'

export interface WizardStepSummaryAndDownloadProps {
  selectedFast: string
  selectedStandard: string
  selectedDeep: string
  selectedChat: string
  selectedTranslation: string
  selectedMedical?: string
  selectedLegal?: string
  selectedVision: string
  selectedEmbedding: string
  useComplexityRouting: boolean
  hardwareProfile: HardwareProfile
  ocrEngine: 'native_cuda' | 'vision_model'
  isAllSlotsPopulated: boolean
  missingModels: string[]
  isCheckingDisk: boolean
  diskCheck: { allowed: boolean; requiredGB: number; freeGB: number; missingGB: number; error?: string } | null
  isPullingModels: boolean
  pullingStatusText: string
  pullProgressPercent: number
  pullErrorDetail: string | null
  onCancelPull: () => void
  onRetryPull?: () => void
  onSkipCurrentPull?: () => void
  onFinishWithoutMissing?: () => void
}

export const WizardStepSummaryAndDownload: React.FC<WizardStepSummaryAndDownloadProps> = ({
  selectedFast,
  selectedStandard,
  selectedDeep,
  selectedChat,
  selectedTranslation,
  selectedMedical,
  selectedLegal,
  selectedVision,
  selectedEmbedding,
  useComplexityRouting,
  hardwareProfile,
  ocrEngine,
  isAllSlotsPopulated,
  missingModels,
  isCheckingDisk,
  diskCheck,
  isPullingModels,
  pullingStatusText,
  pullProgressPercent,
  pullErrorDetail,
  onCancelPull,
  onRetryPull,
  onSkipCurrentPull,
  onFinishWithoutMissing,
}) => {
  const { t } = useTranslation()

  return (
    <div className="space-y-5">
      {/* Summary Box */}
      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <ShieldCheck className="w-4.5 h-4.5 text-emerald-400" /> {t('hardwareWizard.step6Summary')}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
            <span className="text-emerald-300 font-medium">🟢 {t('hardwareWizard.step2Title')}:</span>
            <span className="font-mono text-slate-200 font-semibold">{selectedFast || t('common.none')}</span>
          </div>

          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
            <span className="text-cyan-300 font-medium">🔵 {t('hardwareWizard.step3Title')}:</span>
            <span className="font-mono text-slate-200 font-semibold">{selectedStandard || t('common.none')}</span>
          </div>

          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
            <span className="text-purple-300 font-medium">🟣 {t('hardwareWizard.step4Title')}:</span>
            <span className="font-mono text-slate-200 font-semibold">{selectedDeep || t('common.none')}</span>
          </div>

          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
            <span className="text-cyan-300 font-medium">💬 {t('settings.chatModel')}:</span>
            <span className="font-mono text-slate-200 font-semibold">{selectedChat || t('common.none')}</span>
          </div>

          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
            <span className="text-sky-300 font-medium">🌐 {t('settings.translationModel')}:</span>
            <span className="font-mono text-slate-200 font-semibold">{selectedTranslation || t('common.none')}</span>
          </div>

          {selectedMedical && (
            <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
              <span className="text-rose-300 font-medium">🏥 {t('settings.medicalModel')}:</span>
              <span className="font-mono text-slate-200 font-semibold">{selectedMedical}</span>
            </div>
          )}

          {selectedLegal && (
            <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
              <span className="text-amber-300 font-medium">⚖️ {t('settings.legalModel')}:</span>
              <span className="font-mono text-slate-200 font-semibold">{selectedLegal}</span>
            </div>
          )}

          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
            <span className="text-amber-300 font-medium">👁️ {t('settings.visionOcrLabel')}:</span>
            <span className="font-mono text-slate-200 font-semibold">{selectedVision || t('common.none')}</span>
          </div>

          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
            <span className="text-purple-300 font-medium">🧠 {t('settings.vectorStoreLabel')}:</span>
            <span className="font-mono text-slate-200 font-semibold">{selectedEmbedding || t('common.none')}</span>
          </div>

          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
            <span className="text-slate-400 font-medium">⚙️ {t('sidebar.quickStatus')}:</span>
            <span className="font-mono text-slate-200 font-semibold">
              {useComplexityRouting ? 'Router' : 'Direct'} • {hardwareProfile} • {ocrEngine === 'native_cuda' ? 'CUDA' : 'Vision'}
            </span>
          </div>
        </div>
      </div>

      {/* Incomplete Warning */}
      {!isAllSlotsPopulated ? (
        <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/80 text-xs text-rose-300 space-y-1">
          <div className="flex items-center gap-2 font-bold text-sm">
            <AlertTriangle className="w-4.5 h-4.5 text-rose-400" /> {t('common.warning')}
          </div>
          <p>{t('hardwareWizard.step6Summary')}</p>
        </div>
      ) : missingModels.length > 0 ? (
        <div className="space-y-3">
          <div className="p-3.5 rounded-xl bg-cyan-950/40 border border-cyan-800/80 text-xs text-cyan-300 space-y-2">
            <div className="flex items-center gap-2 font-bold">
              <Download className="w-4 h-4 text-cyan-400" />{' '}
              {t('hardwareWizard.modelsToPull', { count: missingModels.length })}
            </div>
            <div className="font-mono text-[11px] bg-slate-950 p-2 rounded border border-cyan-900/60 text-slate-200 space-y-0.5">
              {missingModels.map((m) => (
                <div key={m}>• {m}</div>
              ))}
            </div>
          </div>

          {/* Disk Space Check Status */}
          {isCheckingDisk ? (
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-400 flex items-center gap-2 font-mono">
              <div className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />{' '}
              {t('hardwareWizard.diskSpaceCheck')}...
            </div>
          ) : diskCheck ? (
            <div
              className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                diskCheck.allowed
                  ? 'bg-emerald-950/30 border-emerald-800/80 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-800/80 text-rose-300'
              }`}
            >
              <div className="flex items-center justify-between font-bold">
                <span className="flex items-center gap-2">
                  {diskCheck.allowed ? (
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-400" />
                  )}
                  {t('hardwareWizard.diskSpaceCheck')}
                </span>
                <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
                  {diskCheck.freeGB} GB {t('hardwareWizard.diskFree')}
                </span>
              </div>
              <p className="text-[11px] text-slate-300">
                {t('hardwareWizard.diskRequired')}:{' '}
                <strong className="font-mono">{diskCheck.requiredGB} GB</strong>
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/80 text-xs text-emerald-300 flex items-center gap-2.5 font-semibold">
          <Check className="w-4.5 h-4.5 text-emerald-400" /> {t('hardwareWizard.allModelsReady')}
        </div>
      )}

      {/* Pull Error Detail & Recovery Action Bar */}
      {pullErrorDetail && (
        <div className="p-4 bg-rose-950/50 border border-rose-800/80 rounded-xl space-y-3">
          <div className="flex items-center gap-2 text-rose-300 font-bold text-xs">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <span>Errore durante il download del modello</span>
          </div>
          <div className="text-xs text-rose-200 font-mono bg-slate-950/80 p-2.5 rounded-lg border border-rose-900/60 break-all">
            {pullErrorDetail}
          </div>
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            {onRetryPull && (
              <button
                type="button"
                onClick={onRetryPull}
                className="px-3 py-1.5 bg-rose-900 hover:bg-rose-800 text-rose-100 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 focus-ring shadow-sm active:scale-95"
              >
                🔄 {t('hardwareWizard.retryPull')}
              </button>
            )}
            {onSkipCurrentPull && (
              <button
                type="button"
                onClick={onSkipCurrentPull}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-medium rounded-xl transition-all flex items-center gap-1.5 focus-ring active:scale-95"
              >
                ⏭️ {t('hardwareWizard.skipModel')}
              </button>
            )}
            {onFinishWithoutMissing && (
              <button
                type="button"
                onClick={onFinishWithoutMissing}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-emerald-700/60 text-emerald-300 text-xs font-medium rounded-xl transition-all flex items-center gap-1.5 focus-ring active:scale-95 ml-auto"
              >
                ✓ {t('hardwareWizard.saveAndFinishAnyway')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Progress Bar */}
      {isPullingModels && (
        <div
          className="space-y-2.5 p-3.5 bg-slate-950 rounded-xl border border-slate-800 text-xs shadow-inner"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center justify-between text-slate-300 font-mono text-[11px]">
            <span className="truncate pr-2">{pullingStatusText}</span>
            <span className="shrink-0 font-bold text-cyan-400">{pullProgressPercent}%</span>
          </div>
          <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
            <div
              className="bg-gradient-to-r from-cyan-500 to-sky-400 h-full transition-all duration-300 rounded-full"
              style={{ width: `${pullProgressPercent}%` }}
            />
          </div>
          <div className="flex justify-end pt-0.5">
            <button
              type="button"
              onClick={onCancelPull}
              className="px-3 py-1 bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all focus-ring active:scale-95"
            >
              <StopCircle className="w-3.5 h-3.5" /> {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
