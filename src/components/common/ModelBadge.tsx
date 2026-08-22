import React from 'react'
import { Zap, Cpu, Sparkles, Bot, Flame } from 'lucide-react'
import { ModelTier } from '../../services/complexityRouterService'

interface ModelBadgeProps {
  modelName: string
  tier?: ModelTier
  tierName?: string
  tooltip?: string
  className?: string
}

export const ModelBadge: React.FC<ModelBadgeProps> = ({
  modelName,
  tier,
  tierName,
  tooltip,
  className = '',
}) => {
  if (!modelName) return null

  // Determine icon & color scheme based on tier if present
  let IconComponent = Bot
  let badgeStyle = 'bg-slate-900/90 text-cyan-300 border-slate-800 hover:border-cyan-500/40'

  if (tier === 'fast') {
    IconComponent = Zap
    badgeStyle = 'bg-emerald-950/70 text-emerald-300 border-emerald-800/80 shadow-sm'
  } else if (tier === 'deep_reasoning') {
    IconComponent = Sparkles
    badgeStyle = 'bg-purple-950/70 text-purple-300 border-purple-800/80 shadow-sm'
  } else if (tier === 'standard') {
    IconComponent = Cpu
    badgeStyle = 'bg-cyan-950/70 text-cyan-300 border-cyan-800/80 shadow-sm'
  } else if (tier === 'heavy') {
    IconComponent = Flame
    badgeStyle = 'bg-amber-950/70 text-amber-300 border-amber-800/80 shadow-sm'
  }

  const titleText = tooltip || (tier && tierName ? `${tierName}: ${modelName}` : tier ? `${tier.toUpperCase()}: ${modelName}` : `Modello: ${modelName}`)

  return (
    <div
      title={titleText}
      role="status"
      aria-label={titleText}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-mono font-semibold border transition-colors select-none ${badgeStyle} ${className}`}
    >
      <IconComponent className="w-3.5 h-3.5 shrink-0 text-current" />
      <span className="truncate max-w-[150px]">{modelName}</span>
      {tier && (
        <span className="text-[10px] uppercase tracking-wider opacity-85 border-l border-current/30 pl-1.5 ml-0.5 font-bold">
          {tier === 'deep_reasoning' ? 'Deep' : tier}
        </span>
      )}
    </div>
  )
}
