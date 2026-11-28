import React from 'react'
import { AppSelect } from '../common/AppSelect'

interface ModelSelectProps {
  value: string
  onChange: React.ChangeEventHandler<HTMLSelectElement>
  ariaLabel: string
  children: React.ReactNode
  disabled?: boolean
  unavailableModel?: string
  unavailableLabel: string
}

export const ModelSelect: React.FC<ModelSelectProps> = ({ value, onChange, ariaLabel, children, disabled = false, unavailableModel, unavailableLabel }) => (
  <div className="w-full space-y-1">
    <AppSelect aria-label={ariaLabel} value={unavailableModel ? '' : value} onChange={onChange} disabled={disabled} className="font-mono font-semibold">
      {children}
    </AppSelect>
    {unavailableModel && (
      <p className="text-[10px] text-amber-300" role="status">
        {unavailableLabel}: <span className="font-mono">{unavailableModel}</span>
      </p>
    )}
  </div>
)
