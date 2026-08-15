import React from 'react'
import { Check, Star, CheckCircle2, AlertTriangle, Zap } from 'lucide-react'
import { getModelFamily, getModelApproxSize } from '../../services/hardwareRecommendationEngine'

export interface ModelOptionCardProps {
  modelName: string
  displayName: string
  description?: string
  sizeBytesApprox?: string
  family?: string
  isRecommended?: boolean
  isInstalled?: boolean
  isSelected: boolean
  onSelect: () => void
  accentColor?: 'emerald' | 'cyan' | 'purple' | 'amber' | 'sky' | 'rose'
  ariaLabel?: string
  compatibilityStatus?: 'optimal_vram' | 'tight_vram' | 'exceeds_vram'
  compatibilityWarning?: string
}

export const ModelOptionCard: React.FC<ModelOptionCardProps> = ({
  modelName,
  displayName,
  description,
  sizeBytesApprox,
  family,
  isRecommended,
  isInstalled,
  isSelected,
  onSelect,
  accentColor = 'cyan',
  ariaLabel,
  compatibilityStatus,
  compatibilityWarning,
}) => {
  const colorStyles = {
    emerald: {
      selectedBg: 'bg-emerald-950/50 border-emerald-400 shadow-md shadow-emerald-950/30 ring-1 ring-emerald-500/30',
      circleSelected: 'border-emerald-400 bg-emerald-400',
    },
    cyan: {
      selectedBg: 'bg-cyan-950/50 border-cyan-400 shadow-md shadow-cyan-950/30 ring-1 ring-cyan-500/30',
      circleSelected: 'border-cyan-400 bg-cyan-400',
    },
    purple: {
      selectedBg: 'bg-purple-950/50 border-purple-400 shadow-md shadow-purple-950/30 ring-1 ring-purple-500/30',
      circleSelected: 'border-purple-400 bg-purple-400',
    },
    amber: {
      selectedBg: 'bg-amber-950/50 border-amber-400 shadow-md shadow-amber-950/30 ring-1 ring-amber-500/30',
      circleSelected: 'border-amber-400 bg-amber-400',
    },
    sky: {
      selectedBg: 'bg-sky-950/50 border-sky-400 shadow-md shadow-sky-950/30 ring-1 ring-sky-500/30',
      circleSelected: 'border-sky-400 bg-sky-400',
    },
    rose: {
      selectedBg: 'bg-rose-950/50 border-rose-400 shadow-md shadow-rose-950/30 ring-1 ring-rose-500/30',
      circleSelected: 'border-rose-400 bg-rose-400',
    },
  }[accentColor]

  const effectiveFamily = family && family !== 'generic' ? family : getModelFamily(modelName)
  const rawSize = sizeBytesApprox && sizeBytesApprox.toLowerCase() !== 'local' ? sizeBytesApprox : undefined
  const effectiveSize = rawSize || getModelApproxSize(modelName)

  return (
    <div
      role="radio"
      aria-checked={isSelected}
      aria-label={ariaLabel || displayName}
      tabIndex={isSelected ? 0 : -1}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between transition-all focus-ring active:scale-[0.99] ${
        isSelected
          ? colorStyles.selectedBg
          : compatibilityStatus === 'exceeds_vram'
          ? 'bg-slate-900/40 border-rose-900/40 hover:border-rose-800/70 hover:bg-slate-900/70'
          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900/90'
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 pr-2">
        <div
          className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-all ${
            isSelected ? colorStyles.circleSelected : 'border-slate-600 bg-slate-950'
          }`}
        >
          {isSelected && <Check className="w-3 h-3 text-slate-950 font-extrabold" />}
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-slate-200 text-xs flex items-center gap-2 flex-wrap">
            <span className="truncate">{displayName}</span>
            {effectiveFamily && effectiveFamily !== 'generic' && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono font-semibold border border-slate-700 uppercase">
                {effectiveFamily}
              </span>
            )}
            {isRecommended && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-bold border border-amber-500/50 shadow-sm flex items-center gap-1">
                <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
                CONSIGLIATO
              </span>
            )}
            {isInstalled && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold border border-emerald-500/50 shadow-sm flex items-center gap-1">
                <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                INSTALLATO
              </span>
            )}
            {compatibilityStatus === 'exceeds_vram' && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono font-bold border border-rose-500/50 shadow-sm flex items-center gap-1">
                <AlertTriangle className="w-2.5 h-2.5 text-rose-400" />
                RISCHIO OOM
              </span>
            )}
            {compatibilityStatus === 'tight_vram' && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-bold border border-amber-500/50 shadow-sm flex items-center gap-1">
                <Zap className="w-2.5 h-2.5 text-amber-400" />
                VRAM RISICATA
              </span>
            )}
          </div>
          {description && (
            <p className="text-[11px] text-slate-400 mt-0.5 leading-snug break-words">{description}</p>
          )}
          {compatibilityWarning && (
            <p className={`text-[10px] mt-1 font-medium ${
              compatibilityStatus === 'exceeds_vram' ? 'text-rose-400' : 'text-amber-400/90'
            }`}>
              {compatibilityWarning}
            </p>
          )}
        </div>
      </div>
      {effectiveSize && (
        <span className="font-mono text-slate-400 text-xs shrink-0 font-medium pl-2">
          {effectiveSize}
        </span>
      )}
    </div>
  )
}
