import React from 'react'
import { FileCode2, X, Split, Save, Terminal, FileText } from 'lucide-react'
import { WorkspaceFile } from '../../types'
import { useTranslation } from '../../i18n'
import { BottomDockTab } from './CodingBottomDock'

interface CodingEditorTabBarProps {
  openFiles: WorkspaceFile[]
  selectedFile: WorkspaceFile | null | undefined
  isSaved: boolean
  onOpenFile: (file: WorkspaceFile) => void
  onCloseFile: (file: WorkspaceFile, e: React.MouseEvent) => void
  isDiffMode: boolean
  setIsDiffMode: (updater: (prev: boolean) => boolean) => void
  onSaveFile: () => void
  isBottomDockOpen?: boolean
  onToggleBottomDock?: () => void
  activeDockTab?: BottomDockTab
  onOpenDockTab?: (tab: BottomDockTab) => void
  planIsReady?: boolean
}

export const CodingEditorTabBar: React.FC<CodingEditorTabBarProps> = ({
  openFiles,
  selectedFile,
  isSaved,
  onOpenFile,
  onCloseFile,
  isDiffMode,
  setIsDiffMode,
  onSaveFile,
  isBottomDockOpen,
  onToggleBottomDock,
  onOpenDockTab,
  planIsReady,
}) => {
  const { t } = useTranslation()

  return (
    <div className="bg-slate-900/90 border-b border-slate-800 px-2 pt-1 flex items-center justify-between text-xs shrink-0 overflow-x-auto select-none">
      <div className="flex items-center gap-1 overflow-x-auto py-0.5" role="tablist" aria-label="File aperti">
        {/* File Tabs */}
        {openFiles.map((file: WorkspaceFile) => {
          const isActive = selectedFile?.path === file.path
          const isDirty = isActive && !isSaved
          return (
            <div
              key={file.path}
              role="tab"
              aria-selected={isActive}
              tabIndex={0}
              onClick={() => onOpenFile(file)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpenFile(file)
                }
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-t-lg font-mono text-xs cursor-pointer transition-all border-x border-slate-800 focus-ring ${
                isActive
                  ? 'bg-slate-950 border-t-2 border-t-cyan-400 text-slate-100 font-bold shadow-md'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850 border-t-2 border-transparent'
              }`}
            >
              <FileCode2 className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
              <span className="truncate max-w-[140px]">{file.name}</span>
              {isDirty && <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" title={t('coding.dirtyBadge')} />}
              <button
                type="button"
                onClick={(e) => onCloseFile(file, e)}
                className="p-0.5 hover:bg-slate-800 hover:text-slate-100 text-slate-400 rounded transition-colors focus-ring cursor-pointer"
                title={t('common.close')}
                aria-label={`${t('common.close')} ${file.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )
        })}

        {openFiles.length === 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-950 border-t-2 border-t-cyan-400 border-x border-slate-800 rounded-t-lg text-slate-400 font-mono text-xs">
            <FileCode2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>{t('coding.noFilesOpen')}</span>
          </div>
        )}
      </div>

      {/* Right Controls: Save, Diff Toggle & Quick Bottom Dock shortcuts */}
      <div className="flex items-center gap-1.5 pb-1">
        {selectedFile && (
          <>
            <button
              type="button"
              onClick={() => setIsDiffMode((prev) => !prev)}
              aria-label={t('coding.diffToggleTitle')}
              className={`p-1.5 rounded-lg border text-xs font-semibold transition-colors flex items-center gap-1 ${
                isDiffMode
                  ? 'bg-cyan-950 text-cyan-300 border-cyan-800'
                  : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              title={isDiffMode ? t('coding.diffStandardTitle') : t('coding.diffToggleTitle')}
            >
              <Split className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={onSaveFile}
              disabled={isSaved}
              aria-label={t('coding.saveButton')}
              className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-30 text-slate-950 font-bold text-xs rounded-lg transition-colors flex items-center gap-1 shadow-md shadow-cyan-950/40"
            >
              <Save className="w-3 h-3" /> {t('coding.saveButton')}
            </button>
          </>
        )}

        {/* Quick Tools Shortcuts */}
        {onOpenDockTab && (
          <div className="flex items-center gap-1 pl-2 border-l border-slate-800">
            <button
              type="button"
              onClick={() => onOpenDockTab('terminal')}
              title="Terminale"
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-cyan-300 transition-colors"
            >
              <Terminal className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onOpenDockTab('plan')}
              title="Piano di Lavoro"
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-amber-300 transition-colors relative"
            >
              <FileText className="w-3.5 h-3.5" />
              {planIsReady && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping absolute top-0.5 right-0.5" />}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
