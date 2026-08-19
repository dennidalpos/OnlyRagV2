import React from 'react'
import { RefreshCw } from 'lucide-react'
import { WorkspaceFile } from '../../types'
import { FileTreeNode } from './FileExplorerTree'

interface WorkspaceExplorerFilesTabProps {
  files: WorkspaceFile[]
  selectedFilePath: string | null
  pinnedPaths: Set<string>
  activeProjectPath: string | null
  onOpenFile: (file: WorkspaceFile) => void
  onTogglePinFile: (file: WorkspaceFile) => void
  onRefreshFiles: () => void
  onAddProject: () => void
}

export const WorkspaceExplorerFilesTab: React.FC<WorkspaceExplorerFilesTabProps> = ({
  files,
  selectedFilePath,
  pinnedPaths,
  activeProjectPath,
  onOpenFile,
  onTogglePinFile,
  onRefreshFiles,
  onAddProject,
}) => {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-2 py-1 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
        <span>Struttura File</span>
        <button
          type="button"
          onClick={onRefreshFiles}
          disabled={!activeProjectPath}
          title="Aggiorna file"
          className="p-1 hover:bg-slate-800 disabled:opacity-30 text-slate-400 hover:text-cyan-300 rounded"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {files.length === 0 ? (
        <div className="p-4 text-center space-y-2 text-slate-400 text-xs font-sans">
          <p>Nessun file aperto o cartella non selezionata.</p>
          <button
            type="button"
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
  )
}
