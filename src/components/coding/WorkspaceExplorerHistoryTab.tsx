import React from 'react'
import { Plus, Eraser } from 'lucide-react'
import { CodingSession } from '../../types'
import { SessionHistoryTree } from './SessionHistoryTree'
import { useTranslation } from '../../i18n'

interface WorkspaceExplorerHistoryTabProps {
  activeProjectName: string
  workspaceSessions: CodingSession[]
  activeSessionId?: string
  onCreateSession: () => void
  onSwitchSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onClearSessions: () => void
  onRenameSession: (id: string, title: string) => void
}

export const WorkspaceExplorerHistoryTab: React.FC<WorkspaceExplorerHistoryTabProps> = ({
  activeProjectName,
  workspaceSessions,
  activeSessionId,
  onCreateSession,
  onSwitchSession,
  onDeleteSession,
  onClearSessions,
  onRenameSession,
}) => {
  const { t } = useTranslation()

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-2 py-1 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
        <span>{t('coding.historyTitle')}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              if (confirm(t('coding.historyClearConfirm'))) onClearSessions()
            }}
            title={t('coding.historyClear')}
            className="p-1 hover:bg-slate-800 text-slate-400 hover:text-rose-400 rounded transition-colors"
          >
            <Eraser className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onCreateSession}
            title={t('coding.newProjectSession')}
            className="p-1 hover:bg-slate-800 text-indigo-400 hover:text-indigo-300 rounded transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {workspaceSessions.length === 0 ? (
        <div className="p-4 text-center text-xs text-slate-400">{t('coding.historyEmpty')}</div>
      ) : (
        <SessionHistoryTree
          projectName={activeProjectName}
          sessions={workspaceSessions}
          activeSessionId={activeSessionId}
          onSwitchSession={onSwitchSession}
          onDeleteSession={onDeleteSession}
          onRenameSession={onRenameSession}
        />
      )}
    </div>
  )
}
