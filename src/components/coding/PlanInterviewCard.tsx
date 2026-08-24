import React, { useState } from 'react'
import { Check, ArrowRight, Sparkles, Sliders } from 'lucide-react'
import type { InterviewQuestion, UserInterviewAnswer } from '../../types'

interface PlanInterviewCardProps {
  questions: InterviewQuestion[]
  onConfirm: (answers: UserInterviewAnswer[]) => void
  onSkipWithRecommended: () => void
  isGenerating?: boolean
}

export const PlanInterviewCard: React.FC<PlanInterviewCardProps> = ({
  questions,
  onConfirm,
  onSkipWithRecommended,
  isGenerating = false,
}) => {
  // State maps question.id -> selected option string (pre-seeded with recommended option)
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const q of questions) {
      initial[q.id] = q.options[q.recommendedIndex] || q.options[0] || ''
    }
    return initial
  })

  // State maps question.id -> custom text input
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({})
  const [activeCustomIds, setActiveCustomIds] = useState<Record<string, boolean>>({})

  const handleSelectOption = (questionId: string, option: string) => {
    setSelectedOptions((prev) => ({ ...prev, [questionId]: option }))
    setActiveCustomIds((prev) => ({ ...prev, [questionId]: false }))
  }

  const handleCustomChange = (questionId: string, value: string) => {
    setCustomInputs((prev) => ({ ...prev, [questionId]: value }))
    if (value.trim()) {
      setActiveCustomIds((prev) => ({ ...prev, [questionId]: true }))
    }
  }

  const handleConfirm = () => {
    const answers: UserInterviewAnswer[] = questions.map((q) => {
      const isCustom = Boolean(activeCustomIds[q.id] && customInputs[q.id]?.trim())
      const chosen = isCustom ? customInputs[q.id].trim() : (selectedOptions[q.id] || q.options[0] || '')
      return {
        questionId: q.id,
        questionText: q.question,
        selectedOption: chosen,
        isCustom,
      }
    })
    onConfirm(answers)
  }

  return (
    <div className="p-4 rounded-2xl bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950 border border-cyan-500/30 shadow-2xl space-y-4 text-xs select-text animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2 text-cyan-400 font-bold tracking-wide uppercase text-[11px]">
          <Sliders className="w-4 h-4 text-cyan-400" />
          <span>Intervista Preliminare Pre-Plan</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-cyan-950/60 border border-cyan-800/40 text-[10px] text-cyan-300">
          <Sparkles className="w-3 h-3 text-cyan-400" />
          <span>Interactive AI</span>
        </div>
      </div>

      <p className="text-slate-300 text-[11px] leading-relaxed">
        L'AI ha analizzato la tua richiesta e individuato alcune scelte tecniche consigliate prima di delineare il piano d'azione:
      </p>

      {/* Questions list */}
      <div className="space-y-4">
        {questions.map((q, qIndex) => {
          const currentSelected = selectedOptions[q.id]
          const isCustomActive = Boolean(activeCustomIds[q.id])

          return (
            <div key={q.id} className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5">
              <div className="flex items-start gap-2 text-slate-100 font-semibold text-xs">
                <span className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-cyan-950 border border-cyan-800/60 text-cyan-300 text-[10px]">
                  {qIndex + 1}
                </span>
                <span className="leading-snug">{q.question}</span>
              </div>

              {/* Options Grid */}
              <div className="grid grid-cols-1 gap-1.5 pt-1">
                {q.options.map((opt, optIndex) => {
                  const isSelected = !isCustomActive && currentSelected === opt
                  const isRecommended = optIndex === q.recommendedIndex

                  return (
                    <button
                      key={optIndex}
                      type="button"
                      onClick={() => handleSelectOption(q.id, opt)}
                      className={`text-left px-3 py-2 rounded-lg border text-xs transition-all flex items-center justify-between gap-2 focus-ring cursor-pointer ${
                        isSelected
                          ? 'bg-cyan-950/60 border-cyan-500/80 text-cyan-200 shadow-sm shadow-cyan-950'
                          : 'bg-slate-900/60 hover:bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                            isSelected ? 'border-cyan-400 bg-cyan-500' : 'border-slate-600'
                          }`}
                        >
                          {isSelected && <Check className="w-2.5 h-2.5 text-slate-950 stroke-[3]" />}
                        </div>
                        <span className="font-medium leading-tight">{opt}</span>
                      </div>

                      {isRecommended && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 text-[9px] font-bold tracking-wider uppercase">
                          Consigliato
                        </span>
                      )}
                    </button>
                  )
                })}

                {/* Custom Write-In Option */}
                <div
                  className={`mt-1 p-2 rounded-lg border transition-all ${
                    isCustomActive
                      ? 'bg-cyan-950/40 border-cyan-500/60'
                      : 'bg-slate-900/40 border-slate-800/80'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <input
                      type="radio"
                      id={`custom_${q.id}`}
                      name={`group_${q.id}`}
                      checked={isCustomActive}
                      onChange={() => setActiveCustomIds((prev) => ({ ...prev, [q.id]: true }))}
                      className="accent-cyan-500"
                    />
                    <label htmlFor={`custom_${q.id}`} className="text-[11px] font-medium text-slate-300 cursor-pointer">
                      Altra scelta personalizzata (write-in):
                    </label>
                  </div>
                  <input
                    type="text"
                    value={customInputs[q.id] || ''}
                    onChange={(e) => handleCustomChange(q.id, e.target.value)}
                    onFocus={() => setActiveCustomIds((prev) => ({ ...prev, [q.id]: true }))}
                    placeholder="Es. usa una specifica libreria o impostazione..."
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-md text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 focus-ring"
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Action Buttons */}
      <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-2">
        <button
          type="button"
          disabled={isGenerating}
          onClick={onSkipWithRecommended}
          className="w-full sm:w-auto px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 text-xs font-semibold transition-all focus-ring cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Salta e usa consigliati
        </button>

        <button
          type="button"
          disabled={isGenerating}
          onClick={handleConfirm}
          className="w-full sm:w-auto px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-slate-950 font-bold text-xs shadow-lg shadow-cyan-950/50 transition-all flex items-center justify-center gap-1.5 active:scale-95 focus-ring cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span>Conferma e Genera Piano</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
