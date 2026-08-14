import React from 'react'
import { Check } from 'lucide-react'

export interface ModelOptionCardProps {
  modelName: string
  displayName: string
  description?: string
  sizeBytesApprox?: string
  isRecommended?: boolean
  isInstalled?: boolean
  isSelected: boolean
  onSelect: () => void
  accentColor?: 'emerald' | 'cyan' | 'purple' | 'amber' | 'sky'
  ariaLabel?: string
}

export const ModelOptionCard: React.FC<ModelOptionCardProps> = ({
  modelName,
  displayName,
  description,
  sizeBytesApprox,
  isRecommended,
  isInstalled,
  isSelected,
  onSelect,
  accentColor = 'cyan',
  ariaLabel,
}) => {
  const colorStyles = {
    emerald: {
      selectedBg: 'bg-emerald-950/40 border-emerald-500 shadow-md',
      circleSelected: 'border-emerald-400 bg-emerald-500',
      badge: 'bg-emerald-950 text-emerald-300 border-emerald-800',
    },
    cyan: {
      selectedBg: 'bg-cyan-950/40 border-cyan-500 shadow-md',
      circleSelected: 'border-cyan-400 bg-cyan-500',
      badge: 'bg-cyan-950 text-cyan-300 border-cyan-800',
    },
    purple: {
      selectedBg: 'bg-purple-950/40 border-purple-500 shadow-md',
      circleSelected: 'border-purple-400 bg-purple-500',
      badge: 'bg-purple-950 text-purple-300 border-purple-800',
    },
    amber: {
      selectedBg: 'bg-amber-950/40 border-amber-500 shadow-md',
      circleSelected: 'border-amber-400 bg-amber-500',
      badge: 'bg-amber-950 text-amber-300 border-amber-800',
    },
    sky: {
      selectedBg: 'bg-sky-950/40 border-sky-500 shadow-md',
      circleSelected: 'border-sky-400 bg-sky-500',
      badge: 'bg-sky-950 text-sky-300 border-sky-800',
    },
  }[accentColor]

  return (
    <div
      role="radio"
      aria-checked={isSelected}
      aria-label={ariaLabel || displayName}
      tabIndex={0}
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
          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 pr-2">
        <div
          className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
            isSelected ? colorStyles.circleSelected : 'border-slate-600'
          }`}
        >
          {isSelected && <Check className="w-3 h-3 text-slate-950 font-bold" />}
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-slate-200 text-xs flex items-center gap-2 flex-wrap">
            <span className="truncate">{displayName}</span>
            {isRecommended && (
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold border ${colorStyles.badge}`}
              >
                RECOMMENDED
              </span>
            )}
            {isInstalled && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 font-mono font-bold border border-emerald-800">
                INSTALLED
              </span>
            )}
          </div>
          {description && (
            <p className="text-[11px] text-slate-400 mt-0.5 truncate">{description}</p>
          )}
        </div>
      </div>
      {sizeBytesApprox && (
        <span className="font-mono text-slate-400 text-xs shrink-0">{sizeBytesApprox}</span>
      )}
    </div>
  )
}
