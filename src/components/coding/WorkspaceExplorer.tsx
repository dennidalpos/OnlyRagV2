import React, { useState } from 'react'
import {
  FolderOpen,
  Plus,
  Trash2,
  Folder,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  RefreshCw,
  X,
  Edit2,
  Check,
  HardDrive,
  FileCode2,
} from 'lucide-react'
import { WorkspaceFile, CodingSession, WorkspaceProject } from '../../types'
import { FileTreeNode } from './FileExplorerTree'
import { useTranslation } from '../../i18n'

interface WorkspaceExplorerProps {
  projects: WorkspaceProject[]
  activeProjectPath: string | null
  onAddProject: () => void
  onRemoveProject: (path: string) => void
  onSelectProject: (path: string) => void
  // File Tree props
  files: WorkspaceFile[]
  selectedFilePath: string | null
  pinnedPaths: Set<string>
  onOpenFile: (file: WorkspaceFile) => void
  onTogglePinFile: (file: WorkspaceFile) => void
  onRefreshFiles: () => void
  // Session History props
  workspaceSessions: CodingSession[]
  activeSessionId?: string
  onCreateSession: () => void
  onSwitchSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onRenameSession: (id: string, title: string) => void
  onClose: () => void
}

export const WorkspaceExplorer: React.FC<WorkspaceExplorerProps> = ({
  projects,
  activeProjectPath,
  onAddProject,
  onRemoveProject,
  onSelectProject,
  files,
  selectedFilePath,
  pinnedPaths,
  onOpenFile,
  onTogglePinFile,
  onRefreshFiles,
  workspaceSessions,
  activeSessionId,
  onCreateSession,
  onSwitchSession,
  onDeleteSession,
  onRenameSession,
  onClose,
}) => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'files' | 'projects' | 'history'>('files')
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitleText, setEditingTitleText] = useState<string>('')

  const activeProjectName = activeProjectPath
    ? activeProjectPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'Workspace'
    : t('coding.noProjectAttached')

  return (
    <div className="w-72 border-r border-slate-800 bg-[#0c1019] flex flex-col h-full shrink-0 z-20 transition-all select-text font-sans">
      {/* Top Header */}
      <div className="p-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 text-xs font-bold text-slate-200">
        <span className="flex items-center gap-2 text-cyan-400">
          <FolderOpen className="w-4 h-4" /> Workspace Explorer
        </span>
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Active Project Header Pill */}
      <div className="p-2.5 bg-slate-950 border-b border-slate-800/80 flex items-center justify-between text-xs gap-2">
        <div className="flex items-center gap-2 truncate flex-1">
          <HardDrive className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <div className="truncate min-w-0">
            <div className="font-bold text-slate-200 truncate text-[11px]">{activeProjectName}</div>
            <div className="text-[9px] text-slate-500 font-mono truncate">{activeProjectPath || t('coding.selectFolder')}</div>
          </div>
        </div>

        <button
          onClick={onAddProject}
          title="Aggiungi cartella progetto"
          className="p-1.5 bg-cyan-950 hover:bg-cyan-900 border border-cyan-800/80 text-cyan-300 rounded-lg transition-all active:scale-95 shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Navigation Sub-tabs */}
      <div className="flex items-center border-b border-slate-800 bg-slate-900/60 text-[11px] font-semibold">
        <button
          onClick={() => setActiveTab('files')}
          className={`flex-1 py-2 text-center border-b-2 transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'files'
              ? 'border-cyan-400 text-cyan-300 bg-slate-900/90'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileCode2 className="w-3.5 h-3.5" /> File ({files.length})
        </button>
        <button
          onClick={() => setActiveTab('projects')}
          className={`flex-1 py-2 text-center border-b-2 transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'projects'
              ? 'border-cyan-400 text-cyan-300 bg-slate-900/90'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Folder className="w-3.5 h-3.5" /> Progetti ({projects.length})
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex-1 py-2 text-center border-b-2 transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'history'
              ? 'border-cyan-400 text-cyan-300 bg-slate-900/90'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" /> Storico ({workspaceSessions.length})
        </button>
      </div>

      {/* Content Panes */}
      <div className="flex-1 overflow-y-auto p-2">
        {/* Tab 1: File Tree */}
        {activeTab === 'files' && (
          <div className="space-y-1">
            <div className="flex items-center justify-between px-2 py-1 text-[10px] text-slate-500 font-bold uppercase tracking-wider">
              <span>Struttura File</span>
              <button
                onClick={onRefreshFiles}
                disabled={!activeProjectPath}
                title="Aggiorna file"
                className="p-1 hover:bg-slate-800 disabled:opacity-30 text-slate-400 hover:text-cyan-300 rounded"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>

            {files.length === 0 ? (
              <div className="p-4 text-center space-y-2 text-slate-500 text-xs font-sans">
                <p>Nessun file aperto o cartella non selezionata.</p>
                <button
                  onClick={onAddProject}
                  className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs rounded-xl transition-all"
                >
                  Seleziona Cartella Progetto
                </button>
              </div>
            ) : (
              <div className="space-y-0.5 font-mono text-xs" role="tree">
                {files.map((file) => (
                  <FileTreeNode
                    key={file.path}
                    item={file}
                    level={0}
                    selectedFilePath={selectedFilePath}
                    pinnedPaths={pinnedPaths}
                    onOpenFile={onOpenFile}
                    onTogglePinFile={onTogglePinFile}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Saved Workspace Projects */}
        {activeTab === 'projects' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-2 py-1 text-[10px] text-slate-500 font-bold uppercase tracking-wider">
              <span>Cartelle Progetto Salvale</span>
              <button
                onClick={onAddProject}
                title="Aggiungi nuova cartella progetto"
                className="p-1 hover:bg-slate-800 text-cyan-400 hover:text-cyan-300 rounded transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {projects.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500">
                Nessun progetto salvato. Aggiungi la tua prima cartella di lavoro.
              </div>
            ) : (
              <div className="space-y-1.5">
                {projects.map((proj) => {
                  const isActive = activeProjectPath === proj.path
                  return (
                    <div
                      key={proj.path}
                      className={`p-2 rounded-xl border text-xs flex items-center justify-between transition-all group ${
                        isActive
                          ? 'bg-cyan-950/60 border-cyan-500/50 text-cyan-200'
                          : 'bg-slate-900/60 hover:bg-slate-900 border-slate-800/80 text-slate-300'
                      }`}
                    >
                      <button
                        onClick={() => onSelectProject(proj.path)}
                        className="flex items-center gap-2 text-left truncate flex-1 min-w-0"
                      >
                        <Folder className={`w-4 h-4 shrink-0 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                        <div className="truncate min-w-0">
                          <div className="font-bold truncate text-[11px]">{proj.name}</div>
                          <div className="text-[9px] font-mono text-slate-500 truncate">{proj.path}</div>
                        </div>
                      </button>

                      <div className="flex items-center gap-1 shrink-0 ml-1">
                        {isActive && (
                          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" title="Progetto Attivo" />
                        )}
                        <button
                          onClick={() => onRemoveProject(proj.path)}
                          title="Rimuovi dalla lista dei progetti"
                          className="p-1 hover:bg-rose-950 text-slate-500 hover:text-rose-400 rounded transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Chat Session History */}
        {activeTab === 'history' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-2 py-1 text-[10px] text-slate-500 font-bold uppercase tracking-wider">
              <span>Storico Chat Progetto</span>
              <button
                onClick={onCreateSession}
                title="Crea nuova sessione di chat"
                className="p-1 hover:bg-slate-800 text-indigo-400 hover:text-indigo-300 rounded transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {workspaceSessions.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500">
                Nessuna sessione di chat registrata per questo progetto.
              </div>
            ) : (
              <div className="space-y-1.5">
                {workspaceSessions.map((session) => {
                  const isActive = session.id === activeSessionId
                  const isEditing = editingSessionId === session.id

                  return (
                    <div
                      key={session.id}
                      className={`p-2 rounded-xl border text-xs flex items-center justify-between transition-all group ${
                        isActive
                          ? 'bg-indigo-950/70 border-indigo-500/50 text-indigo-200'
                          : 'bg-slate-900/60 hover:bg-slate-900 border-slate-800/80 text-slate-300'
                      }`}
                    >
                      {isEditing ? (
                        <div className="flex items-center gap-1.5 w-full">
                          <input
                            type="text"
                            value={editingTitleText}
                            onChange={(e) => setEditingTitleText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                onRenameSession(session.id, editingTitleText)
                                setEditingSessionId(null)
                              } else if (e.key === 'Escape') {
                                setEditingSessionId(null)
                              }
                            }}
                            className="flex-1 bg-slate-950 border border-indigo-500 rounded px-2 py-0.5 text-xs text-slate-100 outline-none"
                            autoFocus
                          />
                          <button
                            onClick={() => {
                              onRenameSession(session.id, editingTitleText)
                              setEditingSessionId(null)
                            }}
                            className="p-1 text-emerald-400 hover:bg-slate-800 rounded"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => onSwitchSession(session.id)}
                            className="flex items-center gap-2 text-left truncate flex-1 min-w-0"
                          >
                            <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-indigo-400' : 'text-slate-500'}`} />
                            <div className="truncate min-w-0">
                              <div className="font-semibold truncate text-[11px]">{session.title}</div>
                              <div className="text-[9px] font-mono text-slate-500">
                                {new Date(session.updatedAt || session.createdAt).toLocaleDateString()} • {session.actionLogs.length} step
                              </div>
                            </div>
                          </button>

                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => {
                                setEditingSessionId(session.id)
                                setEditingTitleText(session.title)
                              }}
                              title="Rinomina"
                              className="p-1 hover:text-cyan-300 rounded"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                            {workspaceSessions.length > 1 && (
                              <button
                                onClick={() => onDeleteSession(session.id)}
                                title="Elimina"
                                className="p-1 hover:text-rose-400 rounded"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
