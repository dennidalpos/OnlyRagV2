import React from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface WorkspaceExplorerTreeSectionProps {
  icon: React.ReactNode
  title: string
  count: number
  expanded: boolean
  onToggleExpanded: () => void
  actions?: React.ReactNode
  children: React.ReactNode
}

export const WorkspaceExplorerTreeSection: React.FC<WorkspaceExplorerTreeSectionProps> = ({
  icon,
  title,
  count,
  expanded,
  onToggleExpanded,
  actions,
  children,
}) => {
  return (
    <div className="mb-1">
      <div className="flex items-center justify-between px-1 py-1.5 rounded-lg hover:bg-slate-900/60 transition-colors">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="flex items-center gap-1.5 text-[10px] text-slate-300 font-bold uppercase tracking-wider flex-1 min-w-0"
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          )}
          {icon}
          <span className="truncate">
            {title} ({count})
          </span>
        </button>
        {actions && <div className="flex items-center gap-1 shrink-0 ml-1">{actions}</div>}
      </div>
      {expanded && <div className="pl-1 pt-0.5">{children}</div>}
    </div>
  )
}
