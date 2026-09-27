import React from 'react'
import { ChevronDown } from 'lucide-react'

type AppSelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { compact?: boolean }

/** Shared native select: one visual treatment with the browser's keyboard and screen reader behavior. */
export const AppSelect: React.FC<AppSelectProps> = ({ compact = false, className = '', children, ...props }) => (
  <span className="relative block w-full">
    <select
      {...props}
      className={`w-full appearance-none rounded-xl border border-slate-700 bg-slate-950 text-slate-100 focus-ring cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${compact ? 'px-2 py-1 pr-7 text-xs' : 'px-3 py-2 pr-9 text-xs'} ${className}`}
    >
      {children}
    </select>
    <ChevronDown
      className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-slate-400 ${compact ? 'right-2 h-3 w-3' : 'right-3 h-3.5 w-3.5'}`}
      aria-hidden="true"
    />
  </span>
)
