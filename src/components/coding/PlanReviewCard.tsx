import React, { useEffect, useMemo, useState } from 'react'
import { Check, Pencil, Save, X } from 'lucide-react'
import type { AgentPlan, PlanMilestone } from '../../types'

interface PlanReviewCardProps {
  plan: AgentPlan
  disabled?: boolean
  onSave?: (revision: AgentPlan) => Promise<boolean>
}

function parseFilePaths(value: string): string[] | undefined {
  const paths = [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim().replace(/\\/g, '/'))
        .filter(Boolean),
    ),
  ]
  return paths.length > 0 ? paths : undefined
}

function invalidFilePath(filePath: string): boolean {
  return pathIsAbsolute(filePath) || filePath.split('/').includes('..')
}

function pathIsAbsolute(filePath: string): boolean {
  return filePath.startsWith('/') || /^[A-Za-z]:\//.test(filePath)
}

export function preparePlanReviewRevision(plan: AgentPlan, objective: string, milestones: PlanMilestone[]): { revision?: AgentPlan; error?: string } {
  const cleanObjective = objective.trim()
  if (!cleanObjective || milestones.some((milestone) => !milestone.title.trim())) {
    return { error: 'Risultato e interventi non possono essere vuoti.' }
  }
  const paths = milestones.flatMap((milestone) => milestone.filePaths || [])
  if (paths.some(invalidFilePath)) {
    return { error: 'I file devono usare percorsi relativi al workspace, senza segmenti "..".' }
  }
  return {
    revision: {
      ...plan,
      objective: cleanObjective,
      milestones: milestones.map((milestone) => ({
        ...milestone,
        title: milestone.title.trim(),
        verificationCommand: milestone.verificationCommand?.trim() || undefined,
      })),
    },
  }
}

export const PlanReviewCard: React.FC<PlanReviewCardProps> = ({ plan, disabled = false, onSave }) => {
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [objective, setObjective] = useState(plan.objective)
  const [milestones, setMilestones] = useState<PlanMilestone[]>(plan.milestones)
  const [filePathInputs, setFilePathInputs] = useState(() => plan.milestones.map((milestone) => (milestone.filePaths || []).join(', ')))
  const [error, setError] = useState('')

  useEffect(() => {
    setIsEditing(false)
    setObjective(plan.objective)
    setMilestones(plan.milestones)
    setFilePathInputs(plan.milestones.map((milestone) => (milestone.filePaths || []).join(', ')))
    setError('')
  }, [plan.id, plan.version])

  const confirmed = useMemo(() => plan.decisions.filter((decision) => decision.source !== 'assumption'), [plan.decisions])
  const assumptions = useMemo(() => plan.decisions.filter((decision) => decision.source === 'assumption'), [plan.decisions])

  const cancel = () => {
    setObjective(plan.objective)
    setMilestones(plan.milestones)
    setFilePathInputs(plan.milestones.map((milestone) => (milestone.filePaths || []).join(', ')))
    setError('')
    setIsEditing(false)
  }

  const save = async () => {
    const prepared = preparePlanReviewRevision(
      plan,
      objective,
      milestones.map((milestone, index) => ({ ...milestone, filePaths: parseFilePaths(filePathInputs[index] || '') })),
    )
    if (!prepared.revision) {
      setError(prepared.error || 'Revisione non valida.')
      return
    }
    if (!onSave) return

    setIsSaving(true)
    setError('')
    const saved = await onSave(prepared.revision)
    setIsSaving(false)
    if (saved) setIsEditing(false)
    else setError('Salvataggio non riuscito. Il piano non è stato modificato.')
  }

  return (
    <section className="p-3 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3 shadow-sm" aria-label="Revisione piano">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">Risultato e decisioni</div>
          {!isEditing && <p className="mt-1 text-xs text-slate-100 font-semibold">{plan.objective}</p>}
        </div>
        {onSave && !isEditing && plan.status === 'ready' && (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            disabled={disabled}
            className="px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:text-cyan-300 disabled:opacity-40 text-[10px] font-semibold flex items-center gap-1.5 focus-ring"
          >
            <Pencil className="w-3 h-3" /> Modifica risultato, file e check
          </button>
        )}
      </div>

      {!isEditing && (confirmed.length > 0 || assumptions.length > 0) && (
        <div className="grid gap-2 md:grid-cols-2">
          <div className="rounded-xl bg-emerald-950/20 border border-emerald-800/40 p-2">
            <div className="text-[10px] font-bold text-emerald-300 uppercase">Decisioni confermate</div>
            {confirmed.length > 0 ? (
              confirmed.map((decision) => (
                <div key={decision.id} className="mt-1 text-[11px] text-slate-200 flex gap-1.5">
                  <Check className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" /> {decision.statement}
                </div>
              ))
            ) : (
              <p className="mt-1 text-[11px] text-slate-500">Nessuna decisione esplicita.</p>
            )}
          </div>
          <div className="rounded-xl bg-amber-950/20 border border-amber-800/40 p-2">
            <div className="text-[10px] font-bold text-amber-300 uppercase">Assunzioni</div>
            {assumptions.length > 0 ? (
              assumptions.map((decision) => (
                <p key={decision.id} className="mt-1 text-[11px] text-slate-200">
                  {decision.statement}
                </p>
              ))
            ) : (
              <p className="mt-1 text-[11px] text-slate-500">Nessuna assunzione aggiuntiva.</p>
            )}
          </div>
        </div>
      )}

      {isEditing && (
        <div className="space-y-3">
          <label className="block text-[10px] font-bold text-slate-300 uppercase">
            Risultato atteso
            <textarea
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              disabled={isSaving}
              className="mt-1 w-full min-h-16 p-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100 normal-case font-normal"
            />
          </label>
          {milestones.map((milestone, index) => (
            <div key={milestone.id} className="p-2 rounded-xl border border-slate-800 bg-slate-950/60 grid gap-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase">
                Intervento {index + 1}
                <input
                  value={milestone.title}
                  onChange={(event) =>
                    setMilestones((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, title: event.target.value } : item)))
                  }
                  disabled={isSaving}
                  className="mt-1 w-full p-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100 normal-case font-normal"
                />
              </label>
              <label className="text-[10px] font-bold text-slate-400 uppercase">
                File, separati da virgola
                <input
                  value={filePathInputs[index] || ''}
                  onChange={(event) => setFilePathInputs((current) => current.map((value, itemIndex) => (itemIndex === index ? event.target.value : value)))}
                  disabled={isSaving}
                  className="mt-1 w-full p-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100 normal-case font-mono"
                />
              </label>
              <label className="text-[10px] font-bold text-slate-400 uppercase">
                Check
                <input
                  value={milestone.verificationCommand || ''}
                  onChange={(event) =>
                    setMilestones((current) =>
                      current.map((item, itemIndex) => (itemIndex === index ? { ...item, verificationCommand: event.target.value } : item)),
                    )
                  }
                  disabled={isSaving}
                  placeholder="es. npm run typecheck"
                  className="mt-1 w-full p-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100 normal-case font-mono"
                />
              </label>
            </div>
          ))}
          {error && (
            <p role="alert" className="text-[11px] text-rose-300">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={cancel}
              disabled={isSaving}
              className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 flex items-center gap-1.5 disabled:opacity-40"
            >
              <X className="w-3 h-3" /> Annulla
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={isSaving || disabled}
              className="px-3 py-1.5 rounded-lg bg-cyan-600 text-slate-950 text-xs font-bold flex items-center gap-1.5 disabled:opacity-40"
            >
              <Save className="w-3 h-3" /> {isSaving ? 'Salvataggio...' : 'Salva revisione'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
