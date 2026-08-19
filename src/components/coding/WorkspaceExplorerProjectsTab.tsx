import React from 'react'
import { Plus, Folder, Trash2 } from 'lucide-react'
import { WorkspaceProject } from '../../types'

interface WorkspaceExplorerProjectsTabProps {
  projects: WorkspaceProject[]
  activeProjectPath: string | null
  onAddProject: () => void
  onSelectProject: (path: string) => void
  onRemoveProject: (path: string) => void
}

export const WorkspaceExplorerProjectsTab: React.FC<WorkspaceExplorerProjectsTabProps> = ({
  projects,
  activeProjectPath,
  onAddProject,
  onSelectProject,
  onRemoveProject,
}) => {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-2 py-1 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
        <span>Cartelle Progetto Salvale</span>
        <button
          type="button"
          onClick={onAddProject}
          title="Aggiungi nuova cartella progetto"
          className="p-1 hover:bg-slate-800 text-cyan-400 hover:text-cyan-300 rounded transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="p-4 text-center text-xs text-slate-400">
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
                  type="button"
                  onClick={() => onSelectProject(proj.path)}
                  className="flex items-center gap-2 text-left truncate flex-1 min-w-0"
                >
                  <Folder className={`w-4 h-4 shrink-0 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                  <div className="truncate min-w-0">
                    <div className="font-bold truncate text-[11px]">{proj.name}</div>
                    <div className="text-[9px] font-mono text-slate-400 truncate">{proj.path}</div>
                  </div>
                </button>

                <div className="flex items-center gap-1 shrink-0 ml-1">
                  {isActive && (
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" title="Progetto Attivo" />
                  )}
                  <button
                    type="button"
                    onClick={() => onRemoveProject(proj.path)}
                    title="Rimuovi dalla lista dei progetti"
                    className="p-1 hover:bg-rose-950 text-slate-400 hover:text-rose-400 rounded transition-colors opacity-0 group-hover:opacity-100"
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
  )
}
