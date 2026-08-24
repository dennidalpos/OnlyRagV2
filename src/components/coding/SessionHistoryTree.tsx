import React, { useState } from 'react'
import { Check, Edit2, MessageSquare } from 'lucide-react'
import { InlineDestructiveConfirm } from '../common/InlineDestructiveConfirm'
import { CodingSession } from '../../types'
import { useTranslation } from '../../i18n'

interface SessionHistoryTreeProps {
  sessions: CodingSession[]
  activeSessionId?: string
  onSwitchSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onRenameSession: (id: string, title: string) => void
  projectName?: string
}

/**
 * Clean and streamlined session history list.
 * Displays only the session/chat names with direct switch, rename, and delete actions,
 * eliminating cluttered metrics, timestamps, diffs, and deep collapsible trees.
 */
export const SessionHistoryTree: React.FC<SessionHistoryTreeProps> = ({
  sessions,
  activeSessionId,
  onSwitchSession,
  onDeleteSession,
  onRenameSession,
}) => {
  const { t } = useTranslation()
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitleText, setEditingTitleText] = useState<string>('')

  const handleStartRename = (session: CodingSession, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingSessionId(session.id)
    setEditingTitleText(session.title)
  }

  const commitRename = (sessionId: string) => {
    const clean = editingTitleText.trim()
    if (clean) {
      onRenameSession(sessionId, clean)
    }
    setEditingSessionId(null)
  }

  return (
    <div className="space-y-0.5 font-sans text-xs" role="list">
      {sessions.map((session) => {
        const isActive = session.id === activeSessionId
        const isEditing = editingSessionId === session.id

        return (
          <div
            key={session.id}
            role="listitem"
            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg group transition-colors ${
              isActive
                ? 'bg-indigo-950/60 border border-indigo-500/40 text-indigo-200 font-semibold shadow-inner'
                : 'border border-transparent text-slate-300 hover:bg-slate-900/80 hover:text-slate-100'
            }`}
          >
            {isEditing ? (
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <MessageSquare className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <input
                  type="text"
                  value={editingTitleText}
                  onChange={(e) => setEditingTitleText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(session.id)
                    else if (e.key === 'Escape') setEditingSessionId(null)
                  }}
                  aria-label={t('common.edit')}
                  className="flex-1 bg-slate-950 border border-indigo-500 rounded px-2 py-0.5 text-xs text-slate-100 outline-none focus-ring font-sans"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => commitRename(session.id)}
                  aria-label={t('common.save')}
                  className="p-1 text-emerald-400 hover:bg-slate-800 rounded focus-ring cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onSwitchSession(session.id)}
                  aria-label={`${session.title} (${isActive ? t('common.active') : ''})`}
                  className="flex items-center gap-2 text-left truncate flex-1 min-w-0 focus-ring rounded cursor-pointer"
                >
                  <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-indigo-400' : 'text-slate-400 group-hover:text-indigo-300'}`} />
                  <span className="truncate text-[11px] min-w-0">{session.title}</span>
                </button>

                <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={(e) => handleStartRename(session, e)}
                    title={t('common.edit')}
                    aria-label={`${t('common.edit')} ${session.title}`}
                    className="p-1 text-slate-400 hover:text-cyan-300 hover:bg-slate-800 rounded transition-colors focus-ring cursor-pointer"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  {sessions.length > 1 && (
                    <InlineDestructiveConfirm
                      itemLabel={session.title}
                      iconClassName="w-3 h-3"
                      className="!p-1 text-slate-400 hover:text-rose-400"
                      onConfirm={() => onDeleteSession(session.id)}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

