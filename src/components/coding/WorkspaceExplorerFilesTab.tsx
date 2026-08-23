import React from 'react'
import { WorkspaceFile } from '../../types'
import { FileTreeNode } from './FileExplorerTree'

interface WorkspaceExplorerFilesTabProps {
  files: WorkspaceFile[]
  selectedFilePath: string | null
  pinnedPaths: Set<string>
  searchFilter?: string
  onOpenFile: (file: WorkspaceFile) => void
  onTogglePinFile: (file: WorkspaceFile) => void
  onAddProject: () => void
}

export const WorkspaceExplorerFilesTab: React.FC<WorkspaceExplorerFilesTabProps> = ({
  files,
  selectedFilePath,
  pinnedPaths,
  searchFilter = '',
  onOpenFile,
  onTogglePinFile,
  onAddProject,
}) => {
  if (files.length === 0) {
    return (
      <div className="p-4 text-center space-y-2 text-slate-400 text-xs font-sans">
        <p>Nessun file aperto o cartella non selezionata.</p>
        <button
          type="button"
          onClick={onAddProject}
          className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-cyan-500/40 text-slate-200 hover:text-cyan-300 font-semibold text-xs rounded-xl transition-all shadow-sm focus-ring cursor-pointer"
        >
          Seleziona Cartella Progetto
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-0.5 font-mono text-xs" role="tree">
      {files.map((file) => (
        <FileTreeNode
          key={file.path}
          item={file}
          level={0}
          selectedFilePath={selectedFilePath}
          pinnedPaths={pinnedPaths}
          searchFilter={searchFilter}
          onOpenFile={onOpenFile}
          onTogglePinFile={onTogglePinFile}
        />
      ))}
    </div>
  )
}
