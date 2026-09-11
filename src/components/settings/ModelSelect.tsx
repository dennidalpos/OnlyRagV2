import React from 'react'
import { ChevronDown } from 'lucide-react'

const MODEL_SELECT_CLASS =
  'w-full appearance-none bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 pr-9 text-xs text-slate-100 focus-ring font-mono font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'

interface ModelSelectProps {
  value: string
  onChange: React.ChangeEventHandler<HTMLSelectElement>
  ariaLabel: string
  children: React.ReactNode
  disabled?: boolean
}

export const ModelSelect: React.FC<ModelSelectProps> = ({ value, onChange, ariaLabel, children, disabled = false }) => (
  <div className="relative w-full">
    <select aria-label={ariaLabel} value={value} onChange={onChange} disabled={disabled} className={MODEL_SELECT_CLASS}>
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
  </div>
)
