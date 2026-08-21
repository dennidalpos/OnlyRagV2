import React, { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  X,
  History,
} from 'lucide-react'
import { WorkspaceFile, CodingSession, WorkspaceProject } from '../../types'
import { useTranslation } from '../../i18n'
import { WorkspaceExplorerFilesTab } from './WorkspaceExplorerFilesTab'
import { WorkspaceExplorerProjectSwitcher } from './WorkspaceExplorerProjectSwitcher'
import { SessionHistoryTree } from './SessionHistoryTree'

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
  onClearSessions: () => void
  onRenameSession: (id: string, title: string) => void
  onOpenPromptHistorySearch: () => void
  onClose: () => void
  width?: number
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
  onOpenPromptHistorySearch,
  onClose,
  width,
}) => {
  const { t } = useTranslation()
  const [searchFilter, setSearchFilter] = useState<string>('')
  const [pinnedExpanded, setPinnedExpanded] = useState<boolean>(true)
  const [filesExpanded, setFilesExpanded] = useState<boolean>(true)
  const [sessionsExpanded, setSessionsExpanded] = useState<boolean>(false)

  const activeProjectName = activeProjectPath
    ? activeProjectPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'Workspace'
    : 'Chat Libera (Standalone)'

  // Extract pinned files objects
  const pinnedFilesList = files.filter((f) => pinnedPaths.has(f.path))

  return (
    <aside
      style={width ? { width: `${width}px` } : undefined}
      className={`${width ? '' : 'w-72'} border-r border-slate-800/80 bg-[#090d16] flex flex-col h-full shrink-0 z-20 select-text font-sans overflow-hidden`}
    >
      {/* Top Header */}
      <div className="h-10 px-3 border-b border-slate-800/80 flex items-center justify-between bg-slate-950/80 text-xs font-bold text-slate-200">
        <span className="flex items-center gap-2 text-cyan-400 text-xs font-semibold">
          <FolderOpen className="w-3.5 h-3.5" /> Workspace Explorer
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Project / Workspace Switcher Header */}
      <WorkspaceExplorerProjectSwitcher
        projects={projects}
        activeProjectPath={activeProjectPath}
        activeProjectName={activeProjectName}
        onAddProject={onAddProject}
        onSelectProject={onSelectProject}
        onRemoveProject={onRemoveProject}
      />

      {/* Quick Search Filter Bar */}
      <div className="px-2 py-1.5 border-b border-slate-800/60 bg-slate-950/40">
        <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-900/90 border border-slate-800 rounded-lg text-xs">
          <Search className="w-3 h-3 text-slate-500 shrink-0" />
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Filtra file..."
            className="w-full bg-transparent text-[11px] text-slate-200 placeholder:text-slate-500 outline-none font-mono"
          />
          {searchFilter && (
            <button
              type="button"
              onClick={() => setSearchFilter('')}
              className="text-slate-500 hover:text-slate-300 p-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Unified Scrollable Sections Container */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 text-xs">
        {/* Section 1: Pinned Context Files (shown if any files are pinned) */}
        {pinnedPaths.size > 0 && (
          <div className="py-1">
            <button
              type="button"
              onClick={() => setPinnedExpanded((prev) => !prev)}
              className="w-full flex items-center justify-between px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider hover:text-slate-200 hover:bg-slate-900/40 transition-colors"
            >
              <span className="flex items-center gap-1 text-cyan-400">
                {pinnedExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                <Pin className="w-3 h-3" />
                <span>Nel Contesto ({pinnedPaths.size})</span>
              </span>
            </button>

            {pinnedExpanded && (
              <div className="px-2 py-1 space-y-0.5">
                {pinnedFilesList.map((file) => (
                  <div
                    key={file.path}
                    onClick={() => onOpenFile(file)}
                    className="flex items-center justify-between px-2 py-1 bg-cyan-950/30 hover:bg-cyan-950/60 border border-cyan-900/40 rounded-md text-[11px] font-mono text-cyan-200 cursor-pointer group transition-colors"
                    title={file.path}
                  >
                    <span className="truncate flex-1">{file.name}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onTogglePinFile(file)
                      }}
                      title="Rimuovi dal contesto"
                      className="p-0.5 text-slate-400 hover:text-rose-400 transition-colors shrink-0 ml-1"
                    >
                      <PinOff className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Section 2: Workspace File Tree */}
        <div className="py-1">
          <div className="flex items-center justify-between px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider hover:bg-slate-900/40 transition-colors group">
            <button
              type="button"
              onClick={() => setFilesExpanded((prev) => !prev)}
              className="flex items-center gap-1 text-slate-300 hover:text-cyan-300 transition-colors flex-1 text-left"
            >
              {filesExpanded ? <ChevronDown className="w-3 h-3 text-slate-400" /> : <ChevronRight className="w-3 h-3 text-slate-400" />}
              <Folder className="w-3 h-3 text-cyan-400" />
              <span>File ({files.length})</span>
            </button>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={onRefreshFiles}
                title="Aggiorna albero file"
                className="p-1 hover:bg-slate-800 text-slate-400 hover:text-cyan-300 rounded transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={onAddProject}
                title="Apri altra cartella"
                className="p-1 hover:bg-slate-800 text-slate-400 hover:text-cyan-300 rounded transition-colors"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>

          {filesExpanded && (
            <div className="px-1.5 pt-0.5">
              <WorkspaceExplorerFilesTab
                files={files}
                selectedFilePath={selectedFilePath}
                pinnedPaths={pinnedPaths}
                searchFilter={searchFilter}
                onOpenFile={onOpenFile}
                onTogglePinFile={onTogglePinFile}
                onAddProject={onAddProject}
              />
            </div>
          )}
        </div>

        {/* Section 3: Session History */}
        <div className="py-1">
          <div className="flex items-center justify-between px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider hover:bg-slate-900/40 transition-colors group">
            <button
              type="button"
              onClick={() => setSessionsExpanded((prev) => !prev)}
              className="flex items-center gap-1 text-slate-300 hover:text-indigo-300 transition-colors flex-1 text-left"
            >
              {sessionsExpanded ? <ChevronDown className="w-3 h-3 text-slate-400" /> : <ChevronRight className="w-3 h-3 text-slate-400" />}
              <History className="w-3 h-3 text-indigo-400" />
              <span>Cronologia ({workspaceSessions.length})</span>
            </button>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onOpenPromptHistorySearch}
                title="Cerca tra tutti i prompt passati"
                className="p-1 hover:bg-slate-800 text-slate-400 hover:text-indigo-300 rounded transition-colors"
              >
                <Search className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={onCreateSession}
                title="Nuova Sessione"
                className="p-1 hover:bg-slate-800 text-indigo-400 hover:text-indigo-300 rounded transition-colors"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>

          {sessionsExpanded && (
            <div className="px-1.5 pt-0.5">
              {workspaceSessions.length === 0 ? (
                <div className="p-3 text-center text-[11px] text-slate-500">
                  Nessuna sessione precedente.
                </div>
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
          )}
        </div>
      </div>
    </aside>
  )
}

