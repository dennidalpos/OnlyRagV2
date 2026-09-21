import React from 'react'
import type { DiagnosticsData } from '../../types'
import { useTranslation } from '../../i18n'

interface SystemRamBreakdownProps {
  memory?: DiagnosticsData['memory'] | null
}

export const SystemRamBreakdown: React.FC<SystemRamBreakdownProps> = ({ memory }) => {
  const { t } = useTranslation()
  const values = [
    [t('diagnostics.ramAvailable'), memory ? `${memory.freeRAMGB} GB` : '-- GB'],
    [t('diagnostics.ramUsed'), memory ? `${memory.usedRAMGB} GB` : '-- GB'],
    [t('diagnostics.ramTotal'), memory ? `${memory.totalRAMGB} GB` : '-- GB'],
  ]

  return (
    <dl className="space-y-0.5 text-[10px] font-mono">
      {values.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-3">
          <dt className="text-slate-400 font-sans">{label}</dt>
          <dd className="text-slate-200 tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
