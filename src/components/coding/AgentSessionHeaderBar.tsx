import React from 'react'
import { FolderOpen, PanelLeft, Square } from 'lucide-react'
import { useTranslation } from '../../i18n'

interface AgentSessionHeaderBarProps {
  workspacePath?: string | null
  onSelectWorkspaceFolder?: () => void
  showWorkspaceSidebar?: boolean
  onToggleWorkspaceSidebar?: () => void
  filesCount?: number
  isExecuting?: boolean
  currentStep?: number
  maxSteps?: number | string
  currentStatusText?: string
  onCancel?: () => void
}

export const AgentSessionHeaderBar: React.FC<AgentSessionHeaderBarProps> = ({
  workspacePath,
  onSelectWorkspaceFolder,
  showWorkspaceSidebar,
  onToggleWorkspaceSidebar,
  filesCount = 0,
  isExecuting = false,
  currentStep = 0,
  maxSteps = 50,
  currentStatusText = '',
  onCancel,
}) => {
  const { t } = useTranslation()

  const projectName = workspacePath
    ? workspacePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'Workspace'
    : t('coding.noProjectAttached')

  return (
    <div className="h-11 px-3 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between gap-2 shrink-0 z-10 select-text font-sans">
      {/* Left: Sidebar Toggle + Project Folder Pill */}
      <div className="flex items-center gap-1.5 min-w-0">
        {onToggleWorkspaceSidebar && (
          <button
            type="button"
            onClick={onToggleWorkspaceSidebar}
            title={showWorkspaceSidebar ? 'Nascondi Workspace Explorer' : `Apri Workspace Explorer (${filesCount} file)`}
            aria-label={showWorkspaceSidebar ? 'Nascondi Workspace Explorer' : `Apri Workspace Explorer (${filesCount} file)`}
            className={`p-1.5 rounded-lg border transition-all text-xs font-medium focus-ring cursor-pointer ${
              showWorkspaceSidebar
                ? 'bg-slate-900 text-cyan-300 border-cyan-500/40 shadow-sm'
                : 'bg-slate-900/80 hover:bg-slate-800 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </button>
        )}

        {workspacePath ? (
          <button
            type="button"
            onClick={onSelectWorkspaceFolder}
            title={`Cartella Workspace: ${workspacePath}`}
            aria-label={`Cartella Workspace: ${workspacePath}`}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-cyan-500/40 text-slate-200 hover:text-cyan-300 transition-all text-xs font-medium truncate focus-ring cursor-pointer shadow-sm"
          >
            <FolderOpen className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="truncate max-w-[140px] sm:max-w-[200px]">{projectName}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onSelectWorkspaceFolder}
            title={t('coding.selectFolder')}
            aria-label={t('coding.selectFolder')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 hover:text-cyan-300 transition-all text-xs font-medium focus-ring cursor-pointer shadow-sm"
          >
            <FolderOpen className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>{t('coding.selectFolder')}</span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {isExecuting && currentStatusText && (
          <span className="max-w-[220px] truncate text-[10px] font-semibold text-cyan-200" title={currentStatusText}>
            {currentStatusText}
          </span>
        )}
        {isExecuting && currentStep > 0 && (
          <span className="px-2 py-0.5 rounded-lg bg-cyan-950/80 border border-cyan-800/60 text-cyan-300 font-mono text-[10px] font-bold animate-pulse">
            Step {currentStep}/{maxSteps}
          </span>
        )}
        {isExecuting && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label={t('coding.stopTask')}
            title={t('coding.stopTask')}
            className="h-7 px-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-1.5 text-[10px] font-bold transition-colors focus-ring"
          >
            <Square className="w-3 h-3 fill-current" />
            {t('coding.stopTask')}
          </button>
        )}
      </div>
    </div>
  )
}
