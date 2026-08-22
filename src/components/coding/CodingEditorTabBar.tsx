import React from 'react'
import { FileCode2, X, Split, Save, Terminal, FileText, GitBranch, ScanLine } from 'lucide-react'
import { WorkspaceFile } from '../../types'
import { useTranslation } from '../../i18n'

export type CodingRightTab = 'editor' | 'terminal' | 'git_diff' | 'plan' | 'slm_diagnostics'

interface CodingEditorTabBarProps {
  openFiles: WorkspaceFile[]
  selectedFile: WorkspaceFile | null | undefined
  isSaved: boolean
  onOpenFile: (file: WorkspaceFile) => void
  onCloseFile: (file: WorkspaceFile, e: React.MouseEvent) => void
  isDiffMode: boolean
  setIsDiffMode: (updater: (prev: boolean) => boolean) => void
  onSaveFile: () => void
  activeTab: CodingRightTab
  onSelectTab: (tab: CodingRightTab) => void
  changedFilesCount?: number
  planIsReady?: boolean
  planIsInProgress?: boolean
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
  activeTab,
  onSelectTab,
  changedFilesCount = 0,
  planIsReady = false,
  planIsInProgress = false,
}) => {
  const { t } = useTranslation()

  return (
    <div className="bg-[#090d16] border-b border-slate-800/80 px-2.5 pt-1.5 flex items-center justify-between text-xs shrink-0 select-none overflow-x-auto">
      {/* Left side: Open File Tabs & Tool View Switchers */}
      <div className="flex items-center gap-1.5 overflow-x-auto py-0.5" role="tablist" aria-label="Aree di lavoro e file">
        {/* Tool Views Tabs */}
        <div className="flex items-center gap-1 pr-2 mr-1 border-r border-slate-800/80 shrink-0">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'terminal'}
            onClick={() => onSelectTab('terminal')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-[11px] font-medium transition-all focus-ring cursor-pointer shadow-sm ${
              activeTab === 'terminal'
                ? 'bg-slate-900 text-cyan-300 border border-cyan-500/40 shadow-cyan-950/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
            }`}
            title="Terminale PowerShell"
          >
            <Terminal className={`w-3.5 h-3.5 ${activeTab === 'terminal' ? 'text-cyan-400' : 'text-slate-400'}`} />
            <span>Terminale</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'git_diff'}
            onClick={() => onSelectTab('git_diff')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-[11px] font-medium transition-all focus-ring cursor-pointer shadow-sm ${
              activeTab === 'git_diff'
                ? 'bg-slate-900 text-indigo-300 border border-indigo-500/40 shadow-indigo-950/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
            }`}
            title="Modifiche Git Diff"
          >
            <GitBranch className={`w-3.5 h-3.5 ${activeTab === 'git_diff' ? 'text-indigo-400' : 'text-slate-400'}`} />
            <span>Modifiche</span>
            {changedFilesCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-indigo-500/20 text-indigo-300 font-mono text-[9px] font-bold border border-indigo-500/30">
                {changedFilesCount}
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'plan'}
            onClick={() => onSelectTab('plan')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-[11px] font-medium transition-all focus-ring cursor-pointer relative shadow-sm ${
              activeTab === 'plan'
                ? 'bg-slate-900 text-amber-300 border border-amber-500/40 shadow-amber-950/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
            }`}
            title="Piano di Lavoro"
          >
            <FileText className={`w-3.5 h-3.5 ${activeTab === 'plan' ? 'text-amber-400' : 'text-slate-400'}`} />
            <span>Piano</span>
            {planIsReady && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping absolute -top-0.5 -right-0.5" />
            )}
            {planIsInProgress && (
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'slm_diagnostics'}
            onClick={() => onSelectTab('slm_diagnostics')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-[11px] font-medium transition-all focus-ring cursor-pointer shadow-sm ${
              activeTab === 'slm_diagnostics'
                ? 'bg-slate-900 text-amber-300 border border-amber-500/40 shadow-amber-950/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
            }`}
            title="Diagnostica e Anomaly Log SLM"
          >
            <ScanLine className={`w-3.5 h-3.5 ${activeTab === 'slm_diagnostics' ? 'text-amber-400' : 'text-slate-400'}`} />
            <span>Diagnostica Log</span>
          </button>
        </div>

        {/* File Tabs */}
        {openFiles.map((file: WorkspaceFile) => {
          const isSelectedFile = selectedFile?.path === file.path
          const isActive = activeTab === 'editor' && isSelectedFile
          const isDirty = isSelectedFile && !isSaved
          return (
            <div
              key={file.path}
              role="tab"
              aria-selected={isActive}
              tabIndex={0}
              onClick={() => {
                onOpenFile(file)
                onSelectTab('editor')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpenFile(file)
                  onSelectTab('editor')
                }
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-t-lg font-mono text-xs cursor-pointer transition-all border-x border-slate-800/80 focus-ring ${
                isActive
                  ? 'bg-[#0d121d] border-t-2 border-t-cyan-400 text-slate-100 font-bold shadow-md'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50 border-t-2 border-transparent'
              }`}
            >
              <FileCode2 className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
              <span className="truncate max-w-[140px]">{file.name}</span>
              {isDirty && <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" title={t('coding.dirtyBadge')} />}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseFile(file, e)
                }}
                className="p-0.5 hover:bg-slate-800 hover:text-slate-100 text-slate-400 rounded transition-colors focus-ring cursor-pointer"
                title={t('common.close')}
                aria-label={`${t('common.close')} ${file.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )
        })}

        {openFiles.length === 0 && activeTab === 'editor' && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0d121d] border-t-2 border-t-cyan-400 border-x border-slate-800/80 rounded-t-lg text-slate-400 font-mono text-xs">
            <FileCode2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>{t('coding.noFilesOpen')}</span>
          </div>
        )}
      </div>

      {/* Right Controls: Save & Diff Toggle in Editor View */}
      <div className="flex items-center gap-1.5 pb-1">
        {activeTab === 'editor' && selectedFile && (
          <>
            <button
              type="button"
              onClick={() => setIsDiffMode((prev) => !prev)}
              aria-label={t('coding.diffToggleTitle')}
              className={`p-1.5 rounded-lg border text-xs font-semibold transition-colors flex items-center gap-1 cursor-pointer ${
                isDiffMode
                  ? 'bg-cyan-950 text-cyan-300 border-cyan-800 shadow-sm'
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
              className="px-3 py-1.5 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 disabled:opacity-30 text-slate-950 font-bold text-xs rounded-lg transition-all flex items-center gap-1 shadow-md shadow-cyan-950/40 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" /> {t('coding.saveButton')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
