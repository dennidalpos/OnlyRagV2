import React, { useState } from 'react'
import { ChevronDown, ChevronRight, FileCode2, Folder, FolderOpen, HardDrive, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { WorkspaceFile, CodingSession, WorkspaceProject } from '../../types'
import { useTranslation } from '../../i18n'
import { WorkspaceExplorerFilesTab } from './WorkspaceExplorerFilesTab'
import { WorkspaceExplorerProjectSwitcher } from './WorkspaceExplorerProjectSwitcher'

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
  onClose,
  width,
}) => {
  const { t } = useTranslation()
  const [projectsExpanded, setProjectsExpanded] = useState(true)

  const activeProjectName = activeProjectPath
    ? activeProjectPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'Workspace'
    : 'Chat Libera (Standalone)'

  return (
    <div
      style={width ? { width: `${width}px` } : undefined}
      className={`${width ? '' : 'w-72'} border-r border-slate-800 bg-[#0c1019] flex flex-col h-full shrink-0 z-20 transition-all select-text font-sans overflow-hidden`}
    >
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

      {/* Active Project Switcher (Quick selection / Deselection) */}
      <WorkspaceExplorerProjectSwitcher
        projects={projects}
        activeProjectPath={activeProjectPath}
        activeProjectName={activeProjectName}
        onAddProject={onAddProject}
        onSelectProject={onSelectProject}
        onRemoveProject={onRemoveProject}
      />

      {/* Simplified Project & Files Tree */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {/* Progetti Workspace */}
        <div className="border border-slate-800/80 rounded-xl overflow-hidden bg-slate-950/60">
          <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-900/80 border-b border-slate-800/60 text-xs font-semibold text-slate-200">
            <button
              type="button"
              onClick={() => setProjectsExpanded((v) => !v)}
              className="flex items-center gap-1.5 text-left flex-1 hover:text-cyan-300 transition-colors"
            >
              {projectsExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
              <Folder className="w-3.5 h-3.5 text-cyan-400" />
              <span>Progetti Workspace</span>
              <span className="text-[10px] font-mono text-slate-400">({projects.length})</span>
            </button>
            <button
              type="button"
              onClick={onAddProject}
              title="Aggiungi nuova cartella progetto"
              className="p-1 hover:bg-slate-800 text-cyan-400 hover:text-cyan-300 rounded transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {projectsExpanded && (
            <div className="p-2 space-y-2">
              {projects.length === 0 ? (
                <div className="text-center py-4 text-xs text-slate-400 space-y-2">
                  <p>Nessun progetto associato.</p>
                  <button
                    type="button"
                    onClick={onAddProject}
                    className="px-3 py-1 bg-cyan-950 hover:bg-cyan-900 border border-cyan-800 text-cyan-300 rounded-lg text-xs transition-colors"
                  >
                    + Apri cartella progetto
                  </button>
                </div>
              ) : (
                projects.map((proj) => {
                  const isProjActive = activeProjectPath === proj.path
                  return (
                    <div
                      key={proj.path}
                      className={`border rounded-lg overflow-hidden transition-colors ${
                        isProjActive ? 'border-cyan-800/80 bg-slate-900/40' : 'border-slate-800/60 bg-slate-950/40'
                      }`}
                    >
                      {/* Project Header Row */}
                      <div className="flex items-center justify-between p-2 hover:bg-slate-900/70 transition-colors group">
                        <button
                          type="button"
                          onClick={() => onSelectProject(proj.path)}
                          className="flex items-center gap-2 min-w-0 flex-1 text-left"
                        >
                          <HardDrive className={`w-3.5 h-3.5 shrink-0 ${isProjActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                          <div className="min-w-0 flex-1 truncate">
                            <div className="font-bold text-[11px] truncate text-slate-200">{proj.name}</div>
                            <div className="text-[9px] font-mono text-slate-400 truncate">{proj.path}</div>
                          </div>
                          {isProjActive && (
                            <span className="text-[9px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800 px-1 py-0.2 rounded shrink-0">
                              Attivo
                            </span>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            onRemoveProject(proj.path)
                          }}
                          title="Rimuovi progetto"
                          className="p-1 text-slate-400 hover:text-rose-400 opacity-0 group-hover:opacity-100 rounded transition-opacity shrink-0"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Active Project Files Tree directly embedded */}
                      {isProjActive && (
                        <div className="border-t border-slate-800/60 p-2 space-y-2 bg-slate-950/60">
                          <div className="flex items-center justify-between text-xs font-semibold text-slate-300 px-1">
                            <span className="flex items-center gap-1.5 text-[11px] text-cyan-400">
                              <FileCode2 className="w-3.5 h-3.5" />
                              <span>File del Progetto ({files.length})</span>
                            </span>
                            <button
                              type="button"
                              onClick={onRefreshFiles}
                              title="Aggiorna file"
                              className="p-1 hover:bg-slate-800 text-slate-400 hover:text-cyan-300 rounded transition-colors"
                            >
                              <RefreshCw className="w-3 h-3" />
                            </button>
                          </div>
                          <WorkspaceExplorerFilesTab
                            files={files}
                            selectedFilePath={selectedFilePath}
                            pinnedPaths={pinnedPaths}
                            onOpenFile={onOpenFile}
                            onTogglePinFile={onTogglePinFile}
                            onAddProject={onAddProject}
                          />
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

