import { Tooltip } from '../common/Tooltip'
import React from 'react'
import { Eye, Cpu, Zap, AlertTriangle } from 'lucide-react'
import { AppSettings, DiagnosticsData } from '../../types'
import { useTranslation } from '../../i18n'

interface OcrEngineBadgeProps {
  settings?: AppSettings
  diagnostics?: DiagnosticsData | null
}

export const OcrEngineBadge: React.FC<OcrEngineBadgeProps> = ({ settings, diagnostics }) => {
  const { t } = useTranslation()
  const isVision = settings?.ocrEngine === 'vision_model'

  if (isVision) {
    const visionModel = settings?.visionModel || 'llama3.2-vision:11b'
    return (
      <div
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-medium"
        title={`Vision OCR: ${visionModel}`}
      >
        <Eye className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span className="font-semibold">{t('ingestion.ocrVisionBadge')}</span>
        <span className="text-amber-400/80 font-mono text-[11px]">({visionModel})</span>
      </div>
    )
  }

  const ocrProvider = diagnostics?.sidecar?.ocr?.provider
  const hostHasGpu = diagnostics?.sidecar?.ocr?.host_has_gpu ?? false
  const isCudaActive = ocrProvider === 'CUDAExecutionProvider'

  return (
    <div className="inline-flex items-center gap-2">
      <div
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs font-medium"
        title="RapidOCR / ONNX Runtime"
      >
        <Cpu className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
        <span>{t('ingestion.ocrNativeBadge')}</span>
      </div>

      {isCudaActive ? (
        <Tooltip helpKey="ingestion_ocrGpuActiveTooltip">
          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-medium">
            <Zap className="w-3 h-3 text-emerald-400 shrink-0" />
            <span>{t('ingestion.ocrGpuActive')}</span>
          </div>
        </Tooltip>
      ) : hostHasGpu ? (
        <Tooltip helpKey="ingestion_ocrGpuPresentUnusedTooltip">
          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] font-medium cursor-help">
            <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
            <span>{t('ingestion.ocrGpuPresentUnused')}</span>
          </div>
        </Tooltip>
      ) : (
        <Tooltip helpKey="ingestion_ocrCpuOnlyTooltip">
          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-slate-400 text-[11px] font-medium">
            <span>{t('ingestion.ocrCpuOnly')}</span>
          </div>
        </Tooltip>
      )}
    </div>
  )
}
