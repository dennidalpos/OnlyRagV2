import { Tooltip, type HelpKey } from '../common/Tooltip'
import React from 'react'
import { CircleDashed, HelpCircle, Ban, Wrench, Gauge, Layers, Boxes } from 'lucide-react'
import type { OllamaModelMetrics } from '../../types'
import { type ModelRuntimeStatus } from '../../../shared/domain/agent/codingModelQualification'
import { useTranslation, type TranslationKey } from '../../i18n'

interface ModelBadgeStripProps {
  status: ModelRuntimeStatus
  /** Undefined for a model that is not installed: capability badges are then omitted. */
  metrics?: OllamaModelMetrics
  className?: string
}

const STATUS_STYLE: Record<ModelRuntimeStatus, { label: TranslationKey; className: string; Icon: typeof CircleDashed }> = {
  compatible: {
    label: 'modelBadges.compatible',
    className: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
    Icon: CircleDashed,
  },
  unsupported: {
    label: 'modelBadges.unsupported',
    className: 'bg-red-500/10 text-red-300 border-red-500/30',
    Icon: Ban,
  },
  unknown: {
    label: 'modelBadges.unknown',
    className: 'bg-slate-700/30 text-slate-400 border-slate-600/40',
    Icon: HelpCircle,
  },
}

const STATUS_TOOLTIP: Record<ModelRuntimeStatus, HelpKey> = {
  compatible: 'modelBadges_compatibleTooltip',
  unsupported: 'modelBadges_unsupportedTooltip',
  unknown: 'modelBadges_unknownTooltip',
}

function formatContext(tokens: number): string {
  return tokens >= 1024 ? `${Math.round(tokens / 1024)}k ctx` : `${tokens} ctx`
}

const Badge: React.FC<{ helpKey: HelpKey; params?: Record<string, string | number>; className: string; children: React.ReactNode }> = ({
  helpKey,
  params,
  className,
  children,
}) => (
  <Tooltip helpKey={helpKey} params={params}>
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-semibold leading-none ${className}`}>{children}</span>
  </Tooltip>
)

export const ModelBadgeStrip: React.FC<ModelBadgeStripProps> = ({ status, metrics, className }) => {
  const { t } = useTranslation()
  const style = STATUS_STYLE[status]
  const supportsTools = metrics?.capabilities?.includes('tools')

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className || ''}`}>
      <Badge helpKey={STATUS_TOOLTIP[status]} className={style.className}>
        <style.Icon className="w-3 h-3" />
        {t(style.label)}
      </Badge>

      {metrics?.contextLength !== undefined && (
        <Badge helpKey="modelBadges_trainedContext" params={{ tokens: metrics.contextLength }} className="bg-slate-800/60 text-slate-300 border-slate-700">
          <Layers className="w-3 h-3" />
          {t('modelBadges.contextCapacity', { context: formatContext(metrics.contextLength) })}
        </Badge>
      )}

      {metrics?.parameterSize && (
        <Badge helpKey="modelBadges_parameters" className="bg-slate-800/60 text-slate-300 border-slate-700">
          <Boxes className="w-3 h-3" />
          {metrics.parameterSize}
        </Badge>
      )}

      {metrics?.quantizationLevel && (
        <Badge helpKey="modelBadges_quantization" className="bg-slate-800/60 text-slate-300 border-slate-700">
          <Gauge className="w-3 h-3" />
          {metrics.quantizationLevel}
        </Badge>
      )}

      {metrics?.capabilities !== undefined && (
        <Badge
          helpKey={supportsTools ? 'modelBadges_nativeTools' : 'modelBadges_noNativeTools'}
          className={supportsTools ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/10 text-amber-300 border-amber-500/30'}
        >
          <Wrench className="w-3 h-3" />
          {supportsTools ? 'tool calling' : 'no tool calling'}
        </Badge>
      )}
    </div>
  )
}
