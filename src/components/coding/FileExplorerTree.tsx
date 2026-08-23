import React, { useState } from 'react'
import {
  Folder,
  FolderOpen,
  FileCode2,
  FileCode,
  FileJson,
  FileText,
  Palette,
  Image as ImageIcon,
  Settings,
  ChevronDown,
  ChevronRight,
  Pin,
  PinOff,
} from 'lucide-react'
import { WorkspaceFile } from '../../types'
import { apiService } from '../../services/api'
import { logger } from '../../lib/logger'

interface FileTreeNodeProps {
  item: WorkspaceFile
  level: number
  selectedFilePath: string | null
  pinnedPaths: Set<string>
  searchFilter?: string
  onOpenFile: (file: WorkspaceFile) => void
  onTogglePinFile: (file: WorkspaceFile) => void
}

const getFileIcon = (fileName: string, isPinned: boolean) => {
  const lower = fileName.toLowerCase()
  const ext = lower.split('.').pop() || ''

  if (lower.startsWith('.env') || lower === '.gitignore' || ext === 'yaml' || ext === 'yml' || ext === 'toml') {
    return <Settings className="w-3.5 h-3.5 text-slate-400 shrink-0" />
  }
  if (ext === 'json') {
    return <FileJson className="w-3.5 h-3.5 text-amber-400 shrink-0" />
  }
  if (ext === 'md' || ext === 'txt' || ext === 'pdf' || ext === 'csv') {
    return <FileText className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
  }
  if (ext === 'css' || ext === 'scss' || ext === 'less') {
    return <Palette className="w-3.5 h-3.5 text-rose-400 shrink-0" />
  }
  if (['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif', 'ico'].includes(ext)) {
    return <ImageIcon className="w-3.5 h-3.5 text-purple-400 shrink-0" />
  }
  if (['ts', 'tsx', 'js', 'jsx'].includes(ext)) {
    return <FileCode className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
  }
  if (ext === 'py') {
    return <FileCode className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
  }

  return <FileCode2 className={`w-3.5 h-3.5 shrink-0 ${isPinned ? 'text-cyan-300' : 'text-slate-400'}`} />
}

export const FileTreeNode: React.FC<FileTreeNodeProps> = ({
  item,
  level,
  selectedFilePath,
  pinnedPaths,
  searchFilter = '',
  onOpenFile,
  onTogglePinFile,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [children, setChildren] = useState<WorkspaceFile[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)

  const isPinned = pinnedPaths.has(item.path)
  const isSelected = selectedFilePath === item.path

  // Check if this item matches search filter
  const matchesFilter = searchFilter
    ? item.name.toLowerCase().includes(searchFilter.toLowerCase())
    : true

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

  const handlePinClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onTogglePinFile(item)
  }

  if (searchFilter && !item.isDir && !matchesFilter) {
    return null
  }

  return (
    <div role="none" className="relative select-none">
      <div
        role="treeitem"
        tabIndex={0}
        aria-expanded={item.isDir ? isOpen : undefined}
        aria-selected={isSelected}
        aria-label={`${item.isDir ? 'Cartella' : 'File'} ${item.name}`}
        onClick={handleToggle}
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
        style={{ paddingLeft: `${Math.max(8, level * 16 + 8)}px` }}
        className={`group py-1.5 pr-2.5 rounded-lg cursor-pointer flex items-center justify-between text-[11px] font-mono transition-all focus-ring my-0.5 ${
          isSelected
            ? 'bg-cyan-950/70 text-cyan-200 border-l-2 border-cyan-400 font-semibold shadow-inner'
            : isPinned
            ? 'bg-cyan-950/25 text-cyan-300 hover:bg-slate-900/90'
            : 'text-slate-300 hover:bg-slate-900/80 hover:text-slate-100'
        }`}
        title={item.path}
      >
        <div className="flex items-center gap-2 truncate min-w-0 flex-1">
          {item.isDir ? (
            <span className="text-slate-500 group-hover:text-slate-300 transition-colors shrink-0">
              {isLoading ? (
                <span className="animate-pulse text-cyan-400 text-[10px]">...</span>
              ) : isOpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-cyan-400" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
              )}
            </span>
          ) : (
            <span className="w-3.5 shrink-0" />
          )}

          {item.isDir ? (
            isOpen ? (
              <FolderOpen className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            ) : (
              <Folder className="w-3.5 h-3.5 text-cyan-500/80 shrink-0" />
            )
          ) : (
            getFileIcon(item.name, isPinned)
          )}

          <span className={`truncate ${searchFilter && matchesFilter && !item.isDir ? 'text-cyan-300 font-bold underline decoration-cyan-500/40' : ''}`}>
            {item.name}
          </span>
        </div>

        {/* Action icons on hover or keyboard focus */}
        {!item.isDir && (
          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={handlePinClick}
              title={isPinned ? 'Rimuovi dal contesto agente (Unpin)' : 'Includi nel contesto agente (Pin)'}
              aria-label={isPinned ? `Rimuovi ${item.name} dal contesto` : `Includi ${item.name} nel contesto`}
              className={`p-1 rounded-md transition-colors focus-ring cursor-pointer ${
                isPinned ? 'text-cyan-300 bg-cyan-950 hover:bg-cyan-900 border border-cyan-800/60' : 'text-slate-400 hover:text-cyan-300 hover:bg-slate-800'
              }`}
            >
              {isPinned ? <PinOff className="w-3 h-3 text-cyan-300" /> : <Pin className="w-3 h-3" />}
            </button>
          </div>
        )}
      </div>

      {/* Directory Children with vertical guide line */}
      {item.isDir && isOpen && (
        <div
          role="group"
          aria-label={`Contenuto cartella ${item.name}`}
          className="relative ml-3 pl-1 border-l border-slate-800/80 space-y-0.5 mt-0.5"
        >
          {children.length === 0 && !isLoading ? (
            <div
              style={{ paddingLeft: `${Math.max(8, (level + 1) * 16 + 8)}px` }}
              className="py-1 text-[10px] text-slate-500 italic font-mono"
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
                searchFilter={searchFilter}
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

