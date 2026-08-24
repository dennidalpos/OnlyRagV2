import React, { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  X,
  ExternalLink,
  Edit2,
  Check,
  Layers,
  Pin,
  PinOff,
} from 'lucide-react'
import { WorkspaceFile, CodingSession, WorkspaceProject } from '../../types'
import { useTranslation } from '../../i18n'
import { WorkspaceExplorerFilesTab } from './WorkspaceExplorerFilesTab'
import { InlineDestructiveConfirm } from '../common/InlineDestructiveConfirm'

interface WorkspaceExplorerProps {
  projects: WorkspaceProject[]
  activeProjectPath: string | null
  onAddProject: () => void
  onRemoveProject: (path: string) => void
  onSelectProject: (path: string | null) => void
  onRenameProject?: (path: string, newName: string) => void
  onOpenProjectPath?: (path: string) => void
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
  onOpenPromptHistorySearch?: () => void
  onClose: () => void
  width?: number
}

/**
 * Workspace Explorer.
 * Hierarchical Project -> Nested Chat/Session architecture without a separate history accordion.
 * Selecting any project or session immediately mounts and populates that project's files.
 */
export const WorkspaceExplorer: React.FC<WorkspaceExplorerProps> = ({
  projects,
  activeProjectPath,
  onAddProject,
  onRemoveProject,
  onSelectProject,
  onRenameProject,
  onOpenProjectPath,
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
  width,
}) => {
  const { t } = useTranslation()
  const [searchFilter, setSearchFilter] = useState<string>('')
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [editingProjectName, setEditingProjectName] = useState<string>('')
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingSessionTitle, setEditingSessionTitle] = useState<string>('')
  const [filesSectionExpanded, setFilesSectionExpanded] = useState<boolean>(true)
  const [pinnedExpanded, setPinnedExpanded] = useState<boolean>(true)

  const isStandalone = !activeProjectPath || !activeProjectPath.trim()

  const handleStartRenameProject = (proj: WorkspaceProject, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingProjectId(proj.path)
    setEditingProjectName(proj.name)
  }

  const handleCommitRenameProject = (projectPath: string) => {
    const clean = editingProjectName.trim()
    if (clean && onRenameProject) {
      onRenameProject(projectPath, clean)
    }
    setEditingProjectId(null)
  }

  const handleStartRenameSession = (session: CodingSession, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingSessionId(session.id)
    setEditingSessionTitle(session.title)
  }

  const handleCommitRenameSession = (sessionId: string) => {
    const clean = editingSessionTitle.trim()
    if (clean) {
      onRenameSession(sessionId, clean)
    }
    setEditingSessionId(null)
  }

  const pinnedFilesList = files.filter((f) => pinnedPaths.has(f.path))

  return (
    <aside
      style={width ? { width: `${width}px` } : undefined}
      className={`${width ? '' : 'w-72'} border-r border-slate-800 bg-slate-950 flex flex-col h-full shrink-0 z-20 select-text font-sans overflow-hidden shadow-2xl`}
    >
      {/* Top Header */}
      <div className="h-11 px-3.5 border-b border-slate-800/90 flex items-center justify-between bg-slate-900/70 text-xs font-bold text-slate-200 shrink-0">
        <div className="flex items-center gap-2 text-cyan-400">
          <div className="w-5 h-5 rounded-md bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-sm">
            <Layers className="w-3 h-3" />
          </div>
          <span className="text-xs font-bold tracking-tight text-slate-100">Workspace</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onAddProject}
            title="Aggiungi Cartella Progetto"
            aria-label="Aggiungi Cartella Progetto"
            className="p-1 hover:bg-slate-800 text-cyan-400 hover:text-cyan-300 rounded-lg transition-colors focus-ring flex items-center gap-1 cursor-pointer"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Scrollable Content */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 text-xs space-y-0.5">
        {/* Section 1: Workspaces & Projects Tree */}
        <div className="p-2 space-y-2">
          {/* Header row */}
          <div className="flex items-center justify-between px-1.5 pt-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            <span className="flex items-center gap-1.5 text-slate-400">
              <HardDrive className="w-3 h-3 text-cyan-400" />
              <span>Progetti ({projects.length})</span>
            </span>
            <button
              type="button"
              onClick={onAddProject}
              className="text-[10px] text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-1 hover:underline cursor-pointer"
            >
              <Plus className="w-2.5 h-2.5" /> Apri Cartella
            </button>
          </div>

          {/* 1.1 Ambiente Temporaneo (Standalone / No Project) */}
          <div
            className={`rounded-xl border transition-all ${
              isStandalone
                ? 'bg-indigo-950/40 border-indigo-500/50 shadow-md shadow-indigo-950/30 ring-1 ring-indigo-500/30'
                : 'bg-slate-900/40 border-slate-800/80 hover:border-slate-700/80 hover:bg-slate-900/70'
            }`}
          >
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelectProject(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelectProject(null)
                }
              }}
              className="p-2.5 flex items-center justify-between gap-2 cursor-pointer focus-ring rounded-xl"
            >
              <div className="flex items-center gap-2 truncate min-w-0">
                <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                  isStandalone ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40' : 'bg-slate-800 text-slate-400'
                }`}>
                  <MessageSquare className="w-3.5 h-3.5" />
                </div>
                <div className="truncate min-w-0">
                  <div className={`font-bold text-[11px] truncate ${isStandalone ? 'text-indigo-200' : 'text-slate-300'}`}>
                    Ambiente Temporaneo
                  </div>
                  <div className="text-[9px] text-slate-400 truncate">
                    Chat libera senza cartella progetto
                  </div>
                </div>
              </div>
              {isStandalone && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shrink-0">
                  Attivo
                </span>
              )}
            </div>

            {/* Standalone sessions and new chat action */}
            {isStandalone && (
              <div className="px-2.5 pb-2.5 pt-1 space-y-1.5 border-t border-indigo-900/40">
                <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold px-1">
                  <span>Chat Attive</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onCreateSession()
                    }}
                    className="text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5 font-bold cursor-pointer"
                  >
                    <Plus className="w-3 h-3" /> Nuova Chat
                  </button>
                </div>

                <div className="space-y-1">
                  {workspaceSessions.map((session) => {
                    const isSessionActive = session.id === activeSessionId
                    const isEditingThis = editingSessionId === session.id

                    return (
                      <div
                        key={session.id}
                        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg group transition-all ${
                          isSessionActive
                            ? 'bg-indigo-900/50 border border-indigo-500/50 text-indigo-100 font-medium'
                            : 'hover:bg-slate-850 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {isEditingThis ? (
                          <div className="flex items-center gap-1 flex-1 min-w-0">
                            <input
                              type="text"
                              value={editingSessionTitle}
                              onChange={(e) => setEditingSessionTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleCommitRenameSession(session.id)
                                else if (e.key === 'Escape') setEditingSessionId(null)
                              }}
                              className="flex-1 bg-slate-950 border border-indigo-500 rounded px-1.5 py-0.5 text-xs text-slate-100 outline-none"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => handleCommitRenameSession(session.id)}
                              className="p-1 text-emerald-400 hover:bg-slate-800 rounded"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => onSwitchSession(session.id)}
                              className="flex items-center gap-1.5 flex-1 min-w-0 text-left truncate cursor-pointer"
                            >
                              <MessageSquare className={`w-3 h-3 shrink-0 ${isSessionActive ? 'text-indigo-400' : 'text-slate-500'}`} />
                              <span className="truncate text-[11px]">{session.title}</span>
                            </button>
                            <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={(e) => handleStartRenameSession(session, e)}
                                title="Rinomina chat"
                                className="p-0.5 text-slate-400 hover:text-cyan-300 rounded"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                              <InlineDestructiveConfirm
                                itemLabel={session.title}
                                hint="Elimina la sessione dell'app"
                                iconClassName="w-3 h-3"
                                className="!p-0.5 text-slate-400 hover:text-rose-400"
                                onConfirm={() => onDeleteSession(session.id)}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="pt-1">
                  <button
                    type="button"
                    onClick={onAddProject}
                    className="w-full py-1 bg-indigo-950/60 hover:bg-indigo-900/80 border border-indigo-800/60 text-indigo-300 text-[10px] font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    <FolderPlus className="w-3 h-3" /> Collega a una cartella di lavoro...
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 1.2 Registered Workspace Projects Hierarchy */}
          {projects.map((proj) => {
            const isProjActive = activeProjectPath === proj.path
            const isEditingProj = editingProjectId === proj.path

            return (
              <div
                key={proj.path}
                className={`rounded-xl border transition-all ${
                  isProjActive
                    ? 'bg-cyan-950/30 border-cyan-500/50 shadow-md shadow-cyan-950/30 ring-1 ring-cyan-500/30'
                    : 'bg-slate-900/40 border-slate-800/80 hover:border-slate-700/80 hover:bg-slate-900/60'
                }`}
              >
                {/* Project Header Row */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectProject(proj.path)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelectProject(proj.path)
                    }
                  }}
                  className="p-2.5 flex items-center justify-between gap-2 cursor-pointer focus-ring rounded-xl group"
                >
                  <div className="flex items-center gap-2 truncate min-w-0 flex-1">
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                      isProjActive ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40' : 'bg-slate-800 text-slate-400'
                    }`}>
                      <Folder className="w-3.5 h-3.5" />
                    </div>

                    <div className="truncate min-w-0 flex-1">
                      {isEditingProj ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            value={editingProjectName}
                            onChange={(e) => setEditingProjectName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleCommitRenameProject(proj.path)
                              else if (e.key === 'Escape') setEditingProjectId(null)
                            }}
                            className="bg-slate-950 border border-cyan-500 rounded px-1.5 py-0.5 text-xs text-slate-100 outline-none w-full"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => handleCommitRenameProject(proj.path)}
                            className="p-1 text-emerald-400 hover:bg-slate-800 rounded"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className={`font-bold text-[11px] truncate flex items-center gap-1.5 ${
                            isProjActive ? 'text-cyan-200' : 'text-slate-200'
                          }`}>
                            <span>{proj.name}</span>
                            {isProjActive && (
                              <span className="px-1 py-0.2 rounded text-[8px] font-mono bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                                In Uso
                              </span>
                            )}
                          </div>
                          <div className="text-[9px] font-mono text-slate-400 truncate" title={proj.path}>
                            {proj.path}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Project Management Actions */}
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                    {onOpenProjectPath && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenProjectPath(proj.path)
                        }}
                        title="Apri cartella root in Esplora Risorse"
                        className="p-1 text-slate-400 hover:text-cyan-300 hover:bg-slate-800 rounded transition-colors focus-ring"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => handleStartRenameProject(proj, e)}
                      title="Rinomina nome visualizzato"
                      className="p-1 text-slate-400 hover:text-cyan-300 hover:bg-slate-800 rounded transition-colors focus-ring"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                    <InlineDestructiveConfirm
                      itemLabel={proj.name}
                      hint="Rimuove solo cronologia e riferimenti app. I file su disco non vengono toccati."
                      iconClassName="w-3 h-3"
                      className="!p-1 text-slate-400 hover:text-rose-400"
                      onConfirm={() => onRemoveProject(proj.path)}
                    />
                  </div>
                </div>

                {/* Nested Sessions for the Active Project */}
                {isProjActive && (
                  <div className="px-2.5 pb-2.5 pt-1 space-y-1.5 border-t border-cyan-900/40 bg-slate-950/40 rounded-b-xl">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold px-1">
                      <span>Chat / Sessioni ({workspaceSessions.length})</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onCreateSession()
                        }}
                        className="text-cyan-400 hover:text-cyan-300 flex items-center gap-0.5 font-bold cursor-pointer"
                      >
                        <Plus className="w-3 h-3" /> Nuova Sessione
                      </button>
                    </div>

                    <div className="space-y-1">
                      {workspaceSessions.map((session) => {
                        const isSessionActive = session.id === activeSessionId
                        const isEditingThis = editingSessionId === session.id

                        return (
                          <div
                            key={session.id}
                            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg group transition-all ${
                              isSessionActive
                                ? 'bg-cyan-950/70 border border-cyan-500/50 text-cyan-100 font-medium'
                                : 'hover:bg-slate-850 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {isEditingThis ? (
                              <div className="flex items-center gap-1 flex-1 min-w-0">
                                <input
                                  type="text"
                                  value={editingSessionTitle}
                                  onChange={(e) => setEditingSessionTitle(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleCommitRenameSession(session.id)
                                    else if (e.key === 'Escape') setEditingSessionId(null)
                                  }}
                                  className="flex-1 bg-slate-950 border border-cyan-500 rounded px-1.5 py-0.5 text-xs text-slate-100 outline-none"
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  onClick={() => handleCommitRenameSession(session.id)}
                                  className="p-1 text-emerald-400 hover:bg-slate-800 rounded"
                                >
                                  <Check className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => onSwitchSession(session.id)}
                                  className="flex items-center gap-1.5 flex-1 min-w-0 text-left truncate cursor-pointer"
                                >
                                  <MessageSquare className={`w-3 h-3 shrink-0 ${isSessionActive ? 'text-cyan-400' : 'text-slate-500'}`} />
                                  <span className="truncate text-[11px]">{session.title}</span>
                                </button>
                                <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    type="button"
                                    onClick={(e) => handleStartRenameSession(session, e)}
                                    title="Rinomina sessione"
                                    className="p-0.5 text-slate-400 hover:text-cyan-300 rounded"
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </button>
                                  <InlineDestructiveConfirm
                                    itemLabel={session.title}
                                    hint="Elimina la sessione dell'app"
                                    iconClassName="w-3 h-3"
                                    className="!p-0.5 text-slate-400 hover:text-rose-400"
                                    onConfirm={() => onDeleteSession(session.id)}
                                  />
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
            )
          })}
        </div>

        {/* Section 2: Active Project Files Explorer */}
        <div className="py-2 px-1">
          <div className="flex items-center justify-between px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider hover:bg-slate-900/40 transition-colors group rounded-lg">
            <button
              type="button"
              onClick={() => setFilesSectionExpanded((prev) => !prev)}
              className="flex items-center gap-1.5 text-slate-300 hover:text-cyan-300 transition-colors flex-1 text-left focus-ring rounded p-0.5"
            >
              {filesSectionExpanded ? <ChevronDown className="w-3 h-3 text-slate-400" /> : <ChevronRight className="w-3 h-3 text-slate-400" />}
              <FolderOpen className="w-3 h-3 text-cyan-400" />
              <span>File Progetto ({files.length})</span>
            </button>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={onRefreshFiles}
                title="Ricarica albero file da disco"
                className="p-1 hover:bg-slate-800 text-slate-400 hover:text-cyan-300 rounded transition-colors focus-ring"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
          </div>

          {filesSectionExpanded && (
            <div className="pt-1.5 space-y-2">
              {/* Quick Search Filter Bar */}
              <div className="px-1.5">
                <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-900/90 border border-slate-800 focus-within:border-cyan-500/50 rounded-xl text-xs transition-colors shadow-inner">
                  <Search className="w-3 h-3 text-slate-500 shrink-0" />
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Filtra file nel progetto..."
                    className="w-full bg-transparent text-[11px] text-slate-200 placeholder:text-slate-500 outline-none font-mono"
                  />
                  {searchFilter && (
                    <button
                      type="button"
                      onClick={() => setSearchFilter('')}
                      className="text-slate-500 hover:text-slate-300 p-0.5 cursor-pointer"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Context Files (Pinned) */}
              {pinnedPaths.size > 0 && (
                <div className="mx-1.5 rounded-lg bg-cyan-950/20 border border-cyan-900/40 p-1.5 space-y-1">
                  <button
                    type="button"
                    onClick={() => setPinnedExpanded((prev) => !prev)}
                    className="w-full flex items-center justify-between text-[10px] font-bold text-cyan-400 uppercase tracking-wider"
                  >
                    <span className="flex items-center gap-1">
                      {pinnedExpanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
                      <Pin className="w-2.5 h-2.5" />
                      <span>Nel Contesto ({pinnedPaths.size})</span>
                    </span>
                  </button>
                  {pinnedExpanded && (
                    <div className="space-y-1 pt-1">
                      {pinnedFilesList.map((file) => (
                        <div
                          key={file.path}
                          onClick={() => onOpenFile(file)}
                          className="flex items-center justify-between px-2 py-1 bg-cyan-950/40 hover:bg-cyan-950/70 border border-cyan-900/50 rounded text-[10px] font-mono text-cyan-200 cursor-pointer"
                        >
                          <span className="truncate flex-1">{file.name}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              onTogglePinFile(file)
                            }}
                            title="Rimuovi dal contesto"
                            className="p-0.5 text-slate-400 hover:text-rose-400"
                          >
                            <PinOff className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* File Tree */}
              <div className="px-1.5">
                {isStandalone ? (
                  <div className="p-3 text-center text-[11px] text-slate-500 space-y-2 bg-slate-900/30 rounded-xl border border-slate-800/60">
                    <p>Nessuna cartella di progetto collegata.</p>
                    <button
                      type="button"
                      onClick={onAddProject}
                      className="px-3 py-1 bg-slate-850 hover:bg-slate-800 border border-slate-700 text-cyan-400 text-[10px] font-semibold rounded-lg transition-colors cursor-pointer"
                    >
                      Collega Cartella Progetto
                    </button>
                  </div>
                ) : (
                  <WorkspaceExplorerFilesTab
                    files={files}
                    selectedFilePath={selectedFilePath}
                    pinnedPaths={pinnedPaths}
                    searchFilter={searchFilter}
                    onOpenFile={onOpenFile}
                    onTogglePinFile={onTogglePinFile}
                    onAddProject={onAddProject}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
