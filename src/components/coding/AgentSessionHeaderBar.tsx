import React, { useState } from 'react'
import { FolderOpen, MessageSquare, ChevronDown, Plus, Check, Edit2, Trash2 } from 'lucide-react'
import { CodingSession } from '../../types'
import { useTranslation } from '../../i18n'

interface AgentSessionHeaderBarProps {
  workspacePath?: string | null
  onSelectWorkspaceFolder?: () => void
  activeSession?: CodingSession | null
  workspaceSessions: CodingSession[]
  activeSessionId?: string
  onCreateSession?: () => void
  onSwitchSession?: (id: string) => void
  onDeleteSession?: (id: string) => void
  onRenameSession?: (id: string, title: string) => void
}

export const AgentSessionHeaderBar: React.FC<AgentSessionHeaderBarProps> = ({
  workspacePath,
  onSelectWorkspaceFolder,
  activeSession,
  workspaceSessions,
  activeSessionId,
  onCreateSession,
  onSwitchSession,
  onDeleteSession,
  onRenameSession,
}) => {
  const { t } = useTranslation()
  const [showSessionsDropdown, setShowSessionsDropdown] = useState(false)
  const [editingSessionTitleId, setEditingSessionTitleId] = useState<string | null>(null)
  const [sessionTitleText, setSessionTitleText] = useState<string>('')

  const projectName = workspacePath ? workspacePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'Workspace' : t('coding.noProjectAttached')

  return (
    <div className="p-2.5 px-4 border-b border-slate-800/90 bg-[#0d131f] flex items-center justify-between gap-3 shrink-0 z-10">
      {/* Left: Project Folder info */}
      <div className="flex items-center gap-2 min-w-0">
        {workspacePath ? (
          <button
            type="button"
            onClick={onSelectWorkspaceFolder}
            title={`Progetto: ${workspacePath}`}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-500/30 text-cyan-200 transition-all text-xs font-semibold truncate focus-ring shadow-sm"
          >
            <FolderOpen className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="truncate max-w-[140px] sm:max-w-[200px]">{projectName}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onSelectWorkspaceFolder}
            title={t('coding.selectFolder')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-cyan-300 transition-all text-xs font-medium focus-ring"
          >
            <FolderOpen className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>{t('coding.selectFolder')}</span>
          </button>
        )}
      </div>

      {/* Right: Nested Sessions Selector & New Chat */}
      <div className="flex items-center gap-1.5 relative">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowSessionsDropdown(!showSessionsDropdown)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-slate-100 transition-all text-xs font-medium focus-ring"
          >
            <MessageSquare className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="truncate max-w-[120px] font-semibold text-slate-200">
              {activeSession?.title || t('coding.sessionTitleDefault')}
            </span>
            <span className="text-[10px] px-1 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/60 font-mono">
              {workspaceSessions.length}
            </span>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          {/* Sessions Dropdown */}
          {showSessionsDropdown && (
            <div className="absolute right-0 top-full mt-1.5 w-64 rounded-2xl bg-[#0f172a] border border-slate-800 shadow-2xl p-2 z-50 space-y-1 animate-in fade-in zoom-in-95 duration-100">
              <div className="flex items-center justify-between px-2 py-1 border-b border-slate-800/80 text-[11px] font-bold text-slate-400">
                <span>{t('coding.projectSessions')}</span>
                <button
                  type="button"
                  onClick={() => {
                    onCreateSession?.()
                    setShowSessionsDropdown(false)
                  }}
                  className="p-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1 text-[10px] font-bold"
                  title={t('coding.newProjectSession')}
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>

              <div className="max-h-56 overflow-y-auto space-y-1 pt-1">
                {workspaceSessions.map((session) => {
                  const isActive = session.id === activeSessionId
                  const isEditing = editingSessionTitleId === session.id

                  return (
                    <div
                      key={session.id}
                      className={`flex items-center justify-between p-1.5 rounded-xl text-xs transition-colors group ${
                        isActive
                          ? 'bg-indigo-950/70 border border-indigo-800/60 text-indigo-200'
                          : 'hover:bg-slate-800/70 text-slate-300'
                      }`}
                    >
                      {isEditing ? (
                        <div className="flex items-center gap-1 w-full">
                          <input
                            type="text"
                            value={sessionTitleText}
                            onChange={(e) => setSessionTitleText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                onRenameSession?.(session.id, sessionTitleText)
                                setEditingSessionTitleId(null)
                              }
                              if (e.key === 'Escape') setEditingSessionTitleId(null)
                            }}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-100 outline-none"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => {
                              onRenameSession?.(session.id, sessionTitleText)
                              setEditingSessionTitleId(null)
                            }}
                            className="p-1 text-emerald-400 hover:bg-slate-800 rounded"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              onSwitchSession?.(session.id)
                              setShowSessionsDropdown(false)
                            }}
                            className="flex-1 text-left truncate flex items-center gap-1.5"
                          >
                            <MessageSquare className={`w-3 h-3 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                            <span className="truncate">{session.title}</span>
                          </button>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSessionTitleId(session.id)
                                setSessionTitleText(session.title)
                              }}
                              className="p-1 hover:text-cyan-300 rounded"
                              title="Rinomina sessione"
                            >
                              <Edit2 className="w-2.5 h-2.5" />
                            </button>
                            {workspaceSessions.length > 1 && (
                              <button
                                type="button"
                                onClick={() => onDeleteSession?.(session.id)}
                                className="p-1 hover:text-rose-400 rounded"
                                title="Elimina sessione"
                              >
                                <Trash2 className="w-2.5 h-2.5" />
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
