import React, { useState } from 'react'
import { Eraser, FileCode2, FolderOpen, MessageSquare, Plus, RefreshCw, X } from 'lucide-react'
import { WorkspaceFile, CodingSession, WorkspaceProject } from '../../types'
import { useTranslation } from '../../i18n'
import { WorkspaceExplorerFilesTab } from './WorkspaceExplorerFilesTab'
import { WorkspaceExplorerHistoryTab } from './WorkspaceExplorerHistoryTab'
import { WorkspaceExplorerProjectSwitcher } from './WorkspaceExplorerProjectSwitcher'
import { WorkspaceExplorerTreeSection } from './WorkspaceExplorerTreeSection'

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
  const [filesExpanded, setFilesExpanded] = useState(true)
  const [historyExpanded, setHistoryExpanded] = useState(true)

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

      {/* Active Project Switcher (replaces the old Progetti tab) */}
      <WorkspaceExplorerProjectSwitcher
        projects={projects}
        activeProjectPath={activeProjectPath}
        activeProjectName={activeProjectName}
        onAddProject={onAddProject}
        onSelectProject={onSelectProject}
        onRemoveProject={onRemoveProject}
      />

      {/* Unified Tree: File and Storico as expandable sections for the active project */}
      <div className="flex-1 overflow-y-auto p-2">
        <WorkspaceExplorerTreeSection
          icon={<FileCode2 className="w-3.5 h-3.5 text-cyan-400" />}
          title="File"
          count={files.length}
          expanded={filesExpanded}
          onToggleExpanded={() => setFilesExpanded((v) => !v)}
          actions={
            <button
              type="button"
              onClick={onRefreshFiles}
              disabled={!activeProjectPath}
              title="Aggiorna file"
              className="p-1 hover:bg-slate-800 disabled:opacity-30 text-slate-400 hover:text-cyan-300 rounded"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          }
        >
          <WorkspaceExplorerFilesTab
            files={files}
            selectedFilePath={selectedFilePath}
            pinnedPaths={pinnedPaths}
            onOpenFile={onOpenFile}
            onTogglePinFile={onTogglePinFile}
            onAddProject={onAddProject}
          />
        </WorkspaceExplorerTreeSection>

        <WorkspaceExplorerTreeSection
          icon={<MessageSquare className="w-3.5 h-3.5 text-cyan-400" />}
          title={t('coding.historyTitle')}
          count={workspaceSessions.length}
          expanded={historyExpanded}
          onToggleExpanded={() => setHistoryExpanded((v) => !v)}
          actions={
            <>
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
            </>
          }
        >
          <WorkspaceExplorerHistoryTab
            activeProjectName={activeProjectName}
            workspaceSessions={workspaceSessions}
            activeSessionId={activeSessionId}
            onSwitchSession={onSwitchSession}
            onDeleteSession={onDeleteSession}
            onRenameSession={onRenameSession}
          />
        </WorkspaceExplorerTreeSection>
      </div>
    </div>
  )
}
