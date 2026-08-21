import React, { useState } from 'react'
import { FolderOpen, MessageSquare, ChevronDown, Plus, Check, Edit2, Trash2, PanelLeft } from 'lucide-react'
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
  showWorkspaceSidebar?: boolean
  onToggleWorkspaceSidebar?: () => void
  filesCount?: number
  isExecuting?: boolean
  currentStep?: number
  maxSteps?: number | string
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
  showWorkspaceSidebar,
  onToggleWorkspaceSidebar,
  filesCount = 0,
  isExecuting = false,
  currentStep = 0,
  maxSteps = 50,
}) => {
  const { t } = useTranslation()
  const [showSessionsDropdown, setShowSessionsDropdown] = useState(false)
  const [editingSessionTitleId, setEditingSessionTitleId] = useState<string | null>(null)
  const [sessionTitleText, setSessionTitleText] = useState<string>('')

  const projectName = workspacePath
    ? workspacePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'Workspace'
    : t('coding.noProjectAttached')

  const realSessions = workspaceSessions.filter(
    (s) => (s.executedPrompts?.length ?? 0) > 0 || (s.actionLogs?.length ?? 0) > 0 || (s.plans?.length ?? 0) > 0
  )
  const currentTitle = activeSession && ((activeSession.executedPrompts?.length ?? 0) > 0 || (activeSession.actionLogs?.length ?? 0) > 0)
    ? activeSession.title
    : 'Studio Coding'

  return (
    <div className="p-2 px-3 border-b border-slate-800/90 bg-[#0d131f] flex items-center justify-between gap-2 shrink-0 z-10 select-none">
      {/* Left: Sidebar Toggle + Project Folder Pill */}
      <div className="flex items-center gap-1.5 min-w-0">
        {onToggleWorkspaceSidebar && (
          <button
            type="button"
            onClick={onToggleWorkspaceSidebar}
            title={showWorkspaceSidebar ? 'Nascondi Workspace Explorer' : `Apri Workspace Explorer (${filesCount} file)`}
            className={`p-1.5 rounded-xl border transition-all text-xs font-medium cursor-pointer ${
              showWorkspaceSidebar
                ? 'bg-cyan-950 text-cyan-300 border-cyan-800/80'
                : 'bg-slate-900/80 hover:bg-slate-850 border-slate-800 text-slate-400 hover:text-slate-200'
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
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-500/30 text-cyan-200 transition-all text-xs font-semibold truncate cursor-pointer shadow-sm"
          >
            <FolderOpen className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="truncate max-w-[110px] sm:max-w-[160px]">{projectName}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onSelectWorkspaceFolder}
            title={t('coding.selectFolder')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 hover:text-cyan-300 transition-all text-xs font-medium cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>{t('coding.selectFolder')}</span>
          </button>
        )}
      </div>

      {/* Right: Session Selector & Step Counter */}
      <div className="flex items-center gap-1.5 relative">
        {isExecuting && currentStep > 0 && (
          <span className="px-2 py-0.5 rounded-lg bg-cyan-950/80 border border-cyan-800/60 text-cyan-300 font-mono text-[10px] font-bold animate-pulse">
            Step {currentStep}/{maxSteps}
          </span>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowSessionsDropdown(!showSessionsDropdown)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900/90 hover:bg-slate-850 border border-slate-800 text-slate-300 hover:text-slate-100 transition-all text-xs font-medium cursor-pointer"
          >
            <MessageSquare className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="truncate max-w-[100px] sm:max-w-[130px] font-semibold text-slate-200">
              {currentTitle}
            </span>
            {realSessions.length > 0 && (
              <span className="text-[10px] px-1 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/60 font-mono font-bold">
                {realSessions.length}
              </span>
            )}
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
                  className="p-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1 text-[10px] font-bold cursor-pointer"
                  title={t('coding.newProjectSession')}
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>

              <div className="max-h-56 overflow-y-auto space-y-1 pt-1">
                {realSessions.length === 0 ? (
                  <div className="text-center py-3 text-[11px] text-slate-400">
                    Nessuna sessione precedente.
                  </div>
                ) : (
                  realSessions.map((session) => {
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
                              className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-100 outline-none font-sans"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => {
                                onRenameSession?.(session.id, sessionTitleText)
                                setEditingSessionTitleId(null)
                              }}
                              className="p-1 text-emerald-400 hover:bg-slate-800 rounded cursor-pointer"
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
                              className="truncate flex-1 text-left font-medium hover:text-indigo-300 transition-colors cursor-pointer"
                            >
                              {session.title || 'Sessione Senza Titolo'}
                            </button>

                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingSessionTitleId(session.id)
                                  setSessionTitleText(session.title)
                                }}
                                className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded cursor-pointer"
                                title="Rinomina"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onDeleteSession?.(session.id)}
                                className="p-1 hover:bg-slate-800 text-slate-400 hover:text-rose-400 rounded cursor-pointer"
                                title="Elimina"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
