import React from 'react'
import { CodingSession } from '../../types'
import { SessionHistoryTree } from './SessionHistoryTree'
import { useTranslation } from '../../i18n'

interface WorkspaceExplorerHistoryTabProps {
  activeProjectName: string
  workspaceSessions: CodingSession[]
  activeSessionId?: string
  onSwitchSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onRenameSession: (id: string, title: string) => void
}

export const WorkspaceExplorerHistoryTab: React.FC<WorkspaceExplorerHistoryTabProps> = ({
  activeProjectName,
  workspaceSessions,
  activeSessionId,
  onSwitchSession,
  onDeleteSession,
  onRenameSession,
}) => {
  const { t } = useTranslation()

  if (workspaceSessions.length === 0) {
    return <div className="p-4 text-center text-xs text-slate-400">{t('coding.historyEmpty')}</div>
  }

  return (
    <SessionHistoryTree
      projectName={activeProjectName}
      sessions={workspaceSessions}
      activeSessionId={activeSessionId}
      onSwitchSession={onSwitchSession}
      onDeleteSession={onDeleteSession}
      onRenameSession={onRenameSession}
    />
  )
}
