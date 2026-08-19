import React, { useState } from 'react'
import { FolderOpen, Plus, HardDrive, FileCode2, Folder, MessageSquare, X } from 'lucide-react'
import { WorkspaceFile, CodingSession, WorkspaceProject } from '../../types'
import { useTranslation } from '../../i18n'
import { WorkspaceExplorerFilesTab } from './WorkspaceExplorerFilesTab'
import { WorkspaceExplorerProjectsTab } from './WorkspaceExplorerProjectsTab'
import { WorkspaceExplorerHistoryTab } from './WorkspaceExplorerHistoryTab'

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
  onClearSessions,
  onRenameSession,
  onClose,
}) => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'files' | 'projects' | 'history'>('files')

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
          type="button"
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
            <div className="text-[9px] text-slate-400 font-mono truncate">{activeProjectPath || t('coding.selectFolder')}</div>
          </div>
        </div>

        <button
          type="button"
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
          type="button"
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
          type="button"
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
          type="button"
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
        {activeTab === 'files' && (
          <WorkspaceExplorerFilesTab
            files={files}
            selectedFilePath={selectedFilePath}
            pinnedPaths={pinnedPaths}
            activeProjectPath={activeProjectPath}
            onOpenFile={onOpenFile}
            onTogglePinFile={onTogglePinFile}
            onRefreshFiles={onRefreshFiles}
            onAddProject={onAddProject}
          />
        )}

        {activeTab === 'projects' && (
          <WorkspaceExplorerProjectsTab
            projects={projects}
            activeProjectPath={activeProjectPath}
            onAddProject={onAddProject}
            onSelectProject={onSelectProject}
            onRemoveProject={onRemoveProject}
          />
        )}

        {activeTab === 'history' && (
          <WorkspaceExplorerHistoryTab
            activeProjectName={activeProjectName}
            workspaceSessions={workspaceSessions}
            activeSessionId={activeSessionId}
            onCreateSession={onCreateSession}
            onSwitchSession={onSwitchSession}
            onDeleteSession={onDeleteSession}
            onClearSessions={onClearSessions}
            onRenameSession={onRenameSession}
          />
        )}
      </div>
    </div>
  )
}
