import React from 'react'
import { BadgeCheck, CircleDashed, HelpCircle, Ban, Wrench, Gauge, Layers, Boxes } from 'lucide-react'
import type { OllamaModelMetrics } from '../../types'
import { findVerificationEvidence, type ModelVerificationStatus } from '../../services/codingModelMatrix'
import { useTranslation, type TranslationKey } from '../../i18n'

/** The badges for one model. */

interface ModelBadgeStripProps {
  modelName: string
  status: ModelVerificationStatus
  /** Undefined for a model that is not installed: capability badges are then omitted. */
  metrics?: OllamaModelMetrics
  className?: string
}

const STATUS_STYLE: Record<ModelVerificationStatus, { label: TranslationKey; className: string; Icon: typeof BadgeCheck }> = {
  verified: {
    label: 'modelBadges.verified',
    className: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    Icon: BadgeCheck,
  },
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

const STATUS_TOOLTIP: Record<Exclude<ModelVerificationStatus, 'verified'>, TranslationKey> = {
  compatible: 'modelBadges.compatibleTooltip',
  unsupported: 'modelBadges.unsupportedTooltip',
  unknown: 'modelBadges.unknownTooltip',
}

function formatContext(tokens: number): string {
  return tokens >= 1024 ? `${Math.round(tokens / 1024)}k ctx` : `${tokens} ctx`
}

const Badge: React.FC<{ title?: string; className: string; children: React.ReactNode }> = ({ title, className, children }) => (
  <span title={title} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-semibold leading-none ${className}`}>
    {children}
  </span>
)

export const ModelBadgeStrip: React.FC<ModelBadgeStripProps> = ({ modelName, status, metrics, className }) => {
  const { t } = useTranslation()
  const style = STATUS_STYLE[status]
  const evidence = status === 'verified' ? findVerificationEvidence(modelName) : null

  // The verified tooltip IS the evidence. Anything less would make the badge a claim the user
  // has no way to check, which is the whole thing this badge was built not to be.
  const statusTooltip = evidence
    ? `${t('modelBadges.verifiedEvidence', { date: evidence.date, probes: evidence.probes.join(', ') })}\n\n${evidence.outcome}`
    : status === 'verified'
      ? ''
      : t(STATUS_TOOLTIP[status])

  const supportsTools = metrics?.capabilities?.includes('tools')

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className || ''}`}>
      <Badge title={statusTooltip} className={style.className}>
        <style.Icon className="w-3 h-3" />
        {t(style.label)}
      </Badge>

      {metrics?.contextLength !== undefined && (
        <Badge title={t('modelBadges.trainedContext', { tokens: metrics.contextLength })} className="bg-slate-800/60 text-slate-300 border-slate-700">
          <Layers className="w-3 h-3" />
          {formatContext(metrics.contextLength)}
        </Badge>
      )}

      {metrics?.parameterSize && (
        <Badge title={t('modelBadges.parameters')} className="bg-slate-800/60 text-slate-300 border-slate-700">
          <Boxes className="w-3 h-3" />
          {metrics.parameterSize}
        </Badge>
      )}

      {metrics?.quantizationLevel && (
        <Badge title={t('modelBadges.quantization')} className="bg-slate-800/60 text-slate-300 border-slate-700">
          <Gauge className="w-3 h-3" />
          {metrics.quantizationLevel}
        </Badge>
      )}

      {/* Drawn only when Ollama actually answered about this model: absent capabilities mean
          "not installed", which is not the same claim as "no tool calling". */}
      {metrics !== undefined && (
        <Badge
          title={supportsTools ? t('modelBadges.nativeTools') : t('modelBadges.noNativeTools')}
          className={supportsTools ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/10 text-amber-300 border-amber-500/30'}
        >
          <Wrench className="w-3 h-3" />
          {supportsTools ? 'tool calling' : 'no tool calling'}
        </Badge>
      )}
    </div>
  )
}
