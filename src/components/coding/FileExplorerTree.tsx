import React, { useState } from 'react'
import { Folder, FolderOpen, FileCode2, ChevronDown, ChevronRight } from 'lucide-react'
import { WorkspaceFile } from '../../types'
import { apiService } from '../../services/api'
import { logger } from '../../lib/logger'

interface FileTreeNodeProps {
  item: WorkspaceFile
  level: number
  selectedFilePath: string | null
  pinnedPaths: Set<string>
  onOpenFile: (file: WorkspaceFile) => void
  onTogglePinFile: (file: WorkspaceFile) => void
}

export const FileTreeNode: React.FC<FileTreeNodeProps> = ({
  item,
  level,
  selectedFilePath,
  pinnedPaths,
  onOpenFile,
  onTogglePinFile,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [children, setChildren] = useState<WorkspaceFile[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)

  const isPinned = pinnedPaths.has(item.path)

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!item.isDir) {
      onOpenFile(item)
      return
    }

    if (isOpen) {
      setIsOpen(false)
    } else {
      setIsOpen(true)
      if (children.length === 0) {
        setIsLoading(true)
        try {
          const subFiles = await apiService.listWorkspaceFiles(item.path)
          setChildren(subFiles)
        } catch (err: any) {
          logger.error('FileTree', `Failed to expand folder: ${err.message}`)
        } finally {
          setIsLoading(false)
        }
      }
    }
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!item.isDir) {
      onTogglePinFile(item)
    }
  }

  return (
    <div role="none">
      <div
        role="treeitem"
        tabIndex={0}
        aria-expanded={item.isDir ? isOpen : undefined}
        aria-selected={selectedFilePath === item.path}
        aria-label={`${item.isDir ? 'Cartella' : 'File'} ${item.name}`}
        onClick={handleToggle}
        onDoubleClick={handleDoubleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (!item.isDir) {
              onOpenFile(item)
            } else {
              setIsOpen((prev) => !prev)
            }
          }
        }}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        className={`py-1.5 pr-2 rounded-lg cursor-pointer flex items-center justify-between transition-all text-xs font-mono select-none focus-ring active:scale-95 ${
          selectedFilePath === item.path
            ? 'bg-emerald-950/40 border border-emerald-500/50 text-emerald-300'
            : isPinned
            ? 'bg-cyan-950/40 border border-cyan-500/40 text-cyan-300'
            : 'text-slate-300 hover:bg-slate-900'
        }`}
        title={!item.isDir ? 'Click to open in editor | Double-click to pin/reference in chat context' : ''}
      >
        <div className="flex items-center gap-1.5 truncate">
          {item.isDir ? (
            isOpen ? (
              <FolderOpen className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            ) : (
              <Folder className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            )
          ) : (
            <FileCode2 className={`w-3.5 h-3.5 shrink-0 ${isPinned ? 'text-cyan-300' : 'text-cyan-400'}`} />
          )}
          <span className="truncate">{item.name}</span>
          {isPinned && <span className="text-[9px] px-1 bg-cyan-900/80 text-cyan-200 rounded font-bold">PIN</span>}
        </div>
        {item.isDir && (
          <span className="text-[10px] text-slate-400 font-sans">
            {isLoading ? '...' : isOpen ? <ChevronDown className="w-3 h-3 text-slate-400" /> : <ChevronRight className="w-3 h-3 text-slate-400" />}
          </span>
        )}
      </div>

      {item.isDir && isOpen && (
        <div role="group" aria-label={`Contenuto cartella ${item.name}`} className="space-y-0.5 mt-0.5">
          {children.length === 0 && !isLoading ? (
            <div
              style={{ paddingLeft: `${(level + 1) * 12 + 8}px` }}
              className="py-1 text-[11px] text-slate-400 italic font-mono"
            >
              (cartella vuota)
            </div>
          ) : (
            children.map((child) => (
              <FileTreeNode
                key={child.path}
                item={child}
                level={level + 1}
                selectedFilePath={selectedFilePath}
                pinnedPaths={pinnedPaths}
                onOpenFile={onOpenFile}
                onTogglePinFile={onTogglePinFile}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
