import React from 'react'
import { ShieldCheck, AlertTriangle, Download, Check, StopCircle } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { HardwareProfile } from '../../types'
import { getModelApproxSize } from '../../services/hardwareRecommendationEngine'

export interface WizardStepSummaryAndDownloadProps {
  selectedCoding: string
  selectedCodingFallback?: string
  selectedChat: string
  selectedChatFallback?: string
  selectedTranslation: string
  selectedTranslationFallback?: string
  selectedMedical?: string
  selectedLegal?: string
  selectedVision: string
  selectedEmbedding: string
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
    <div className="space-y-4">
      {/* Summary Box */}
      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <ShieldCheck className="w-4.5 h-4.5 text-emerald-400" /> Riepilogo Suite Modelli
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
            <span className="text-cyan-300 font-medium">💻 Coding Workhorse:</span>
            <span className="font-mono text-slate-200 font-semibold">{selectedCoding || t('common.none')}</span>
          </div>

          {selectedCodingFallback && (
            <div className="p-2 rounded-lg bg-slate-900 border border-amber-900/40 flex justify-between items-center">
              <span className="text-amber-300 font-medium">🛡️ Coding Fallback:</span>
              <span className="font-mono text-amber-200 font-semibold">{selectedCodingFallback}</span>
            </div>
          )}

          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
            <span className="text-purple-300 font-medium">💬 RAG Chat:</span>
            <span className="font-mono text-slate-200 font-semibold">{selectedChat || t('common.none')}</span>
          </div>

          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
            <span className="text-sky-300 font-medium">🌐 Traduzione:</span>
            <span className="font-mono text-slate-200 font-semibold">{selectedTranslation || t('common.none')}</span>
          </div>

          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
            <span className="text-amber-300 font-medium">👁️ Vision OCR:</span>
            <span className="font-mono text-slate-200 font-semibold">{selectedVision || t('common.none')}</span>
          </div>

          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
            <span className="text-purple-300 font-medium">🧠 Embedding Vettoriale:</span>
            <span className="font-mono text-slate-200 font-semibold">{selectedEmbedding || t('common.none')}</span>
          </div>

          {selectedMedical && (
            <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
              <span className="text-rose-300 font-medium">🏥 Clinico / Medico:</span>
              <span className="font-mono text-slate-200 font-semibold">{selectedMedical}</span>
            </div>
          )}

          {selectedLegal && (
            <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
              <span className="text-amber-300 font-medium">⚖️ Legale / Normativo:</span>
              <span className="font-mono text-slate-200 font-semibold">{selectedLegal}</span>
            </div>
          )}

          <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center md:col-span-2">
            <span className="text-slate-400 font-medium">⚙️ {t('sidebar.quickStatus')}:</span>
            <span className="font-mono text-slate-200 font-semibold">
              {hardwareProfile} • {ocrEngine === 'native_cuda' ? 'CUDA Native' : 'Vision Model'}
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
          <p>{t('hardwareWizard.incompleteSlotsWarning')}</p>
        </div>
      ) : missingModels.length > 0 ? (
        <div className="space-y-3">
          <div className="p-3.5 rounded-xl bg-cyan-950/40 border border-cyan-800/80 text-xs text-cyan-300 space-y-2">
            <div className="flex items-center gap-2 font-bold">
              <Download className="w-4 h-4 text-cyan-400" />{' '}
              {t('hardwareWizard.modelsToPull', { count: missingModels.length })}
            </div>
            <div className="font-mono text-[11px] bg-slate-950 p-2 rounded border border-cyan-900/60 text-slate-200 space-y-1">
              {missingModels.map((m) => {
                const approxSize = getModelApproxSize(m)
                return (
                  <div key={m} className="flex items-center justify-between gap-2 py-0.5 border-b border-slate-800/40 last:border-0">
                    <span className="truncate">• {m}</span>
                    {approxSize && (
                      <span className="text-[10px] text-slate-400 shrink-0 font-sans">
                        ~{approxSize} GB
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Disk space check banner */}
          {isCheckingDisk ? (
            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400 flex items-center gap-2">
              <div className="w-3.5 h-3.5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              <span>Verifica spazio su disco in corso...</span>
            </div>
          ) : diskCheck && !diskCheck.allowed ? (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800 text-xs text-rose-300 space-y-1">
              <div className="flex items-center gap-1.5 font-bold">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" /> Spazio su disco insufficiente
              </div>
              <p>
                Richiesti ~{diskCheck.requiredGB} GB, disponibili {diskCheck.freeGB} GB.
                {diskCheck.error && ` (${diskCheck.error})`}
              </p>
            </div>
          ) : null}

          {/* Pulling progress / cancel banner */}
          {isPullingModels && (
            <div className="p-4 rounded-xl bg-slate-900 border border-cyan-700/60 space-y-3">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-cyan-300 truncate max-w-xs">{pullingStatusText}</span>
                <span className="text-cyan-400 font-bold">{pullProgressPercent}%</span>
              </div>
              <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                <div
                  className="bg-cyan-500 h-full transition-all duration-300"
                  style={{ width: `${Math.max(0, Math.min(100, pullProgressPercent))}%` }}
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                {onSkipCurrentPull && (
                  <button
                    type="button"
                    onClick={onSkipCurrentPull}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition-colors"
                  >
                    Salta questo modello
                  </button>
                )}
                <button
                  type="button"
                  onClick={onCancelPull}
                  className="px-2.5 py-1 bg-rose-950 hover:bg-rose-900 border border-rose-700 text-rose-200 text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors"
                >
                  <StopCircle className="w-3.5 h-3.5" /> Annulla download
                </button>
              </div>
            </div>
          )}

          {/* Pull error banner */}
          {pullErrorDetail && (
            <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-700 text-xs text-rose-200 space-y-2">
              <div className="flex items-center gap-1.5 font-bold">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" /> Errore durante il download
              </div>
              <p className="font-mono text-[11px] text-rose-300">{pullErrorDetail}</p>
              <div className="flex items-center gap-2 pt-1">
                {onRetryPull && (
                  <button
                    type="button"
                    onClick={onRetryPull}
                    className="px-3 py-1 bg-rose-900 hover:bg-rose-800 text-rose-100 text-xs font-bold rounded-lg transition-colors"
                  >
                    Riprova
                  </button>
                )}
                {onFinishWithoutMissing && (
                  <button
                    type="button"
                    onClick={onFinishWithoutMissing}
                    className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors"
                  >
                    Continua senza scaricare
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/80 text-xs text-emerald-300 flex items-center gap-2.5">
          <Check className="w-5 h-5 text-emerald-400 shrink-0" />
          <div>
            <div className="font-bold">Tutti i modelli sono già installati e pronti!</div>
            <div className="text-[11px] text-emerald-400/80">
              Puoi completare la configurazione e iniziare subito a utilizzare OnlyRag.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
