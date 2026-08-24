import React from 'react'
import { BadgeCheck, CircleDashed, HelpCircle, Ban, Wrench, Gauge, Layers, Boxes } from 'lucide-react'
import type { OllamaModelMetrics } from '../../types'
import {
  findVerificationEvidence,
  type ModelVerificationStatus,
} from '../../services/codingModelMatrix'

/**
 * The badges for one model.
 *
 * The settings panel used to show a model's tag and nothing else, so choosing between
 * `qwen2.5-coder:7b` and `deepseek-coder:6.7b` meant knowing the difference already. Every
 * number rendered here is READ, never estimated: capabilities, context length, parameter size
 * and quantization all come from Ollama's own `/api/tags`, and a field Ollama does not report
 * is simply not drawn. There is no placeholder and no plausible-looking default — a made-up
 * context length would be worse than an absent one, because the user would act on it.
 *
 * The verification badge is the one that carries a promise, so it is the one held to evidence:
 * `verified` renders only for a model listed in codingModelMatrix.ts with a live run recorded
 * behind it, and the tooltip shows that run, its date and what it failed to do.
 */

interface ModelBadgeStripProps {
  modelName: string
  status: ModelVerificationStatus
  /** Undefined for a model that is not installed: capability badges are then omitted. */
  metrics?: OllamaModelMetrics
  className?: string
}

const STATUS_STYLE: Record<ModelVerificationStatus, { label: string; className: string; Icon: typeof BadgeCheck }> = {
  verified: {
    label: 'Verificato',
    className: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    Icon: BadgeCheck,
  },
  compatible: {
    label: 'Compatibile',
    className: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
    Icon: CircleDashed,
  },
  unsupported: {
    label: 'Non supportato',
    className: 'bg-red-500/10 text-red-300 border-red-500/30',
    Icon: Ban,
  },
  unknown: {
    label: 'Non testato',
    className: 'bg-slate-700/30 text-slate-400 border-slate-600/40',
    Icon: HelpCircle,
  },
}

const STATUS_TOOLTIP: Record<ModelVerificationStatus, string> = {
  verified: '',
  compatible:
    'Dichiara le capacità che l\'agente richiede ed è nel catalogo, ma non è mai stato eseguito contro le sonde live. Utilizzabile, non dimostrato.',
  unsupported:
    'Manca qualcosa che l\'agente richiede — tipicamente il tool calling nativo, o è un modello di embedding senza superficie di chat. Selezionabile a tuo rischio.',
  unknown: 'Tag non presente nel catalogo di questa app. Nessuna garanzia di funzionamento.',
}

function formatContext(tokens: number): string {
  return tokens >= 1024 ? `${Math.round(tokens / 1024)}k ctx` : `${tokens} ctx`
}

const Badge: React.FC<{ title?: string; className: string; children: React.ReactNode }> = ({
  title,
  className,
  children,
}) => (
  <span
    title={title}
    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-semibold leading-none ${className}`}
  >
    {children}
  </span>
)

export const ModelBadgeStrip: React.FC<ModelBadgeStripProps> = ({ modelName, status, metrics, className }) => {
  const style = STATUS_STYLE[status]
  const evidence = status === 'verified' ? findVerificationEvidence(modelName) : null

  // The verified tooltip IS the evidence. Anything less would make the badge a claim the user
  // has no way to check, which is the whole thing this badge was built not to be.
  const statusTooltip = evidence
    ? `Testato il ${evidence.date} con: ${evidence.probes.join(', ')}.\n\n${evidence.outcome}`
    : STATUS_TOOLTIP[status]

  const supportsTools = metrics?.capabilities?.includes('tools')

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className || ''}`}>
      <Badge title={statusTooltip} className={style.className}>
        <style.Icon className="w-3 h-3" />
        {style.label}
      </Badge>

      {metrics?.contextLength !== undefined && (
        <Badge
          title={`Contesto addestrato: ${metrics.contextLength} token. Ollama limita a questo valore qualunque num_ctx più alto, senza segnalarlo.`}
          className="bg-slate-800/60 text-slate-300 border-slate-700"
        >
          <Layers className="w-3 h-3" />
          {formatContext(metrics.contextLength)}
        </Badge>
      )}

      {metrics?.parameterSize && (
        <Badge title="Parametri dichiarati dal modello" className="bg-slate-800/60 text-slate-300 border-slate-700">
          <Boxes className="w-3 h-3" />
          {metrics.parameterSize}
        </Badge>
      )}

      {metrics?.quantizationLevel && (
        <Badge title="Livello di quantizzazione" className="bg-slate-800/60 text-slate-300 border-slate-700">
          <Gauge className="w-3 h-3" />
          {metrics.quantizationLevel}
        </Badge>
      )}

      {/* Drawn only when Ollama actually answered about this model: absent capabilities mean
          "not installed", which is not the same claim as "no tool calling". */}
      {metrics !== undefined && (
        <Badge
          title={
            supportsTools
              ? 'Tool calling nativo: l\'agente usa il percorso strutturato di Ollama.'
              : 'Nessun tool calling nativo: l\'agente ripiega sul JSON in blocco recintato, misurabilmente più fragile sui modelli piccoli.'
          }
          className={
            supportsTools
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
              : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
          }
        >
          <Wrench className="w-3 h-3" />
          {supportsTools ? 'tool calling' : 'no tool calling'}
        </Badge>
      )}
    </div>
  )
}
