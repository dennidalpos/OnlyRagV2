import React from 'react'

interface StatCardProps {
  label: string
  value: string | number
  color: string
  icon: React.ReactNode
}

export const SlmDiagnosticsStatCard: React.FC<StatCardProps> = ({ label, value, color, icon }) => (
  <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center gap-2.5">
    <div className={`shrink-0 ${color}`}>{icon}</div>
    <div className="min-w-0">
      <div className={`text-sm font-mono font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-slate-400 truncate">{label}</div>
    </div>
  </div>
)
