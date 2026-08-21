import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, Folder, HardDrive, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { WorkspaceProject } from '../../types'

interface WorkspaceExplorerProjectSwitcherProps {
  projects: WorkspaceProject[]
  activeProjectPath: string | null
  activeProjectName: string
  onAddProject: () => void
  onSelectProject: (path: string) => void
  onRemoveProject: (path: string) => void
}

export const WorkspaceExplorerProjectSwitcher: React.FC<WorkspaceExplorerProjectSwitcherProps> = ({
  projects,
  activeProjectPath,
  activeProjectName,
  onAddProject,
  onSelectProject,
  onRemoveProject,
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const handleSelect = (path: string) => {
    onSelectProject(path)
    setIsOpen(false)
  }

  return (
    <div className="relative p-2.5 bg-slate-950 border-b border-slate-800/80" ref={dropdownRef}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          className="flex items-center gap-2 truncate flex-1 min-w-0 text-left hover:bg-slate-900/60 rounded-lg p-0.5 transition-colors"
        >
          {activeProjectPath ? (
            <HardDrive className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          ) : (
            <MessageSquare className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          )}
          <div className="truncate min-w-0 flex-1">
            <div className="font-bold text-slate-200 truncate text-[11px]">{activeProjectName}</div>
            <div className="text-[9px] text-slate-400 font-mono truncate">{activeProjectPath || 'Chat Libera (Nessuna cartella)'}</div>
          </div>
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        <button
          type="button"
          onClick={onAddProject}
          title="Aggiungi cartella progetto"
          className="p-1.5 bg-cyan-950 hover:bg-cyan-900 border border-cyan-800/80 text-cyan-300 rounded-lg transition-all active:scale-95 shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {isOpen && (
        <div
          role="listbox"
          className="absolute top-full left-2.5 right-2.5 mt-1.5 z-50 bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden max-h-72 overflow-y-auto divide-y divide-slate-800/60"
        >
          {/* Option for Free Chat / Standalone Mode */}
          <div
            role="option"
            aria-selected={!activeProjectPath}
            className={`px-3 py-2 flex items-center justify-between gap-2 cursor-pointer transition-colors group ${
              !activeProjectPath ? 'bg-indigo-950/60 text-indigo-200' : 'hover:bg-slate-800/80 text-slate-300'
            }`}
            onClick={() => handleSelect('')}
          >
            <div className="flex items-center gap-2 truncate min-w-0">
              <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${!activeProjectPath ? 'text-indigo-400' : 'text-slate-400'}`} />
              <div className="truncate min-w-0">
                <div className="font-bold truncate text-[11px]">Chat Libera (Standalone)</div>
                <div className="text-[9px] font-mono text-slate-400 truncate">Nessuna cartella progetto associata</div>
              </div>
            </div>
            {!activeProjectPath && (
              <span className="text-[9px] font-mono bg-indigo-900/60 text-indigo-300 px-1.5 py-0.5 rounded">Attiva</span>
            )}
          </div>
          {projects.length === 0 ? (
            <div className="p-3 text-center text-xs text-slate-400">
              Nessun progetto salvato. Aggiungi la tua prima cartella di lavoro.
            </div>
          ) : (
            projects.map((proj) => {
              const isActive = activeProjectPath === proj.path
              return (
                <div
                  key={proj.path}
                  role="option"
                  aria-selected={isActive}
                  className={`px-3 py-2 flex items-center justify-between gap-2 cursor-pointer transition-colors group ${
                    isActive ? 'bg-cyan-950/60 text-cyan-200' : 'hover:bg-slate-800/80 text-slate-300'
                  }`}
                  onClick={() => handleSelect(proj.path)}
                >
                  <div className="flex items-center gap-2 truncate min-w-0">
                    <Folder className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                    <div className="truncate min-w-0">
                      <div className="font-bold truncate text-[11px]">{proj.name}</div>
                      <div className="text-[9px] font-mono text-slate-400 truncate">{proj.path}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveProject(proj.path)
                    }}
                    title="Rimuovi dalla lista dei progetti"
                    className="p-1 hover:bg-rose-950 text-slate-400 hover:text-rose-400 rounded transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
