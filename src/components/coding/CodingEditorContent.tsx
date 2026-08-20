import React from 'react'
import Editor, { DiffEditor } from '@monaco-editor/react'
import { FileCode2, ChevronRight, Copy, Check } from 'lucide-react'
import { AppSettings } from '../../types'
import { GitDiffPanel } from './GitDiffPanel'
import { CodingTerminal } from './CodingTerminal'
import { ActivitiesPanel } from './ActivitiesPanel'
import { SlmDiagnosticsPanel } from './SlmDiagnosticsPanel'
import { PlanPanel } from './PlanPanel'
import { useCodingAgent } from '../../hooks/useCodingAgent'
import { usePlanApproval } from '../../hooks/usePlanApproval'
import { useTranslation } from '../../i18n'
import { getLanguageFromExtension, getBreadcrumbParts } from './codingEditorUtils'

interface CodingEditorContentProps {
  c: ReturnType<typeof useCodingAgent>
  planApproval: ReturnType<typeof usePlanApproval>
  settings?: AppSettings
  activeModelName: string
  isDiffMode: boolean
  copiedPath: boolean
  onCopyPath: () => void
  onShowWorkspaceSidebar: () => void
  autoScroll: boolean
}

export const CodingEditorContent: React.FC<CodingEditorContentProps> = ({
  c,
  planApproval,
  settings,
  activeModelName,
  isDiffMode,
  copiedPath,
  onCopyPath,
  onShowWorkspaceSidebar,
  autoScroll,
}) => {
  const { t } = useTranslation()

  return (
    <>
      {/* Breadcrumbs Navigation Bar */}
      {c.selectedFile && c.activeTab === 'editor' && (
        <div className="px-4 py-1.5 bg-[#0e131f] border-b border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400 shrink-0">
          <div className="flex items-center gap-1 truncate">
            {getBreadcrumbParts(c.selectedFile.path, t('common.noFileOpen')).map((part, idx, arr) => (
              <React.Fragment key={idx}>
                <span className={idx === arr.length - 1 ? 'text-slate-200 font-semibold' : 'text-slate-400'}>
                  {part}
                </span>
                {idx < arr.length - 1 && <ChevronRight className="w-3 h-3 text-slate-700 shrink-0" />}
              </React.Fragment>
            ))}
          </div>

          <button
            type="button"
            onClick={onCopyPath}
            aria-label={t('coding.copyPath')}
            className="p-1 text-slate-400 hover:text-slate-300 transition-colors"
            title={t('coding.copyPath')}
          >
            {copiedPath ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}

      {/* Editor / Terminal Content Area */}
      <div className="flex-1 relative overflow-hidden bg-[#0d121d]">
        {c.activeTab === 'editor' && (
          c.selectedFile ? (
            isDiffMode ? (
              <DiffEditor
                height="100%"
                theme="vs-dark"
                language={getLanguageFromExtension(c.selectedFile?.name)}
                original={c.originalContent || ''}
                modified={c.editorContent}
                options={{
                  fontSize: 13,
                  automaticLayout: true,
                  fontFamily: 'Fira Code, Cascadia Code, monospace',
                  minimap: { enabled: false },
                  renderSideBySide: false,
                  wordWrap: settings?.editorWordWrap !== false ? 'on' : 'off',
                }}
              />
            ) : (
              <Editor
                height="100%"
                theme="vs-dark"
                language={getLanguageFromExtension(c.selectedFile?.name)}
                value={c.editorContent}
                onChange={(val) => {
                  c.setEditorContent(val || '')
                  c.setIsSaved(false)
                }}
                options={{
                  fontSize: 13,
                  minimap: { enabled: true },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  fontFamily: 'Fira Code, Cascadia Code, monospace',
                  wordWrap: settings?.editorWordWrap !== false ? 'on' : 'off',
                  lineNumbers: 'on',
                }}
              />
            )
          ) : (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-3 text-slate-400 font-sans">
              <FileCode2 className="w-10 h-10 text-cyan-500/40" />
              <div className="text-slate-300 font-semibold text-sm">{t('coding.noFilesOpen')}</div>
              <p className="text-xs text-slate-400 max-w-sm">
                {t('coding.emptyLogs')}
              </p>
              <button
                type="button"
                onClick={onShowWorkspaceSidebar}
                className="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded-xl text-xs transition-colors"
              >
                {t('coding.filesTab')}
              </button>
            </div>
          )
        )}

        {c.activeTab === 'plan' && (
          <PlanPanel
            plan={planApproval.currentPlan}
            planHistory={planApproval.planHistory}
            activePlanIndex={planApproval.activePlanIndex}
            onSelectPlanVersion={planApproval.selectPlanVersion}
            isGenerating={planApproval.isGeneratingPlan}
            isExecuting={c.isExecuting}
            countdownSeconds={planApproval.countdownSeconds}
            isAutoProceedPaused={planApproval.isAutoProceedPaused}
            autoProceedEnabled={settings?.autoProceedPlan !== false}
            onApprove={planApproval.handleApprovePlan}
            onReject={planApproval.handleRejectPlan}
            onTogglePauseAutoProceed={() => planApproval.setIsAutoProceedPaused(!planApproval.isAutoProceedPaused)}
            onUpdatePlanText={planApproval.handleUpdatePlanText}
            completedStepCount={c.currentStep}
          />
        )}

        {c.activeTab === 'activities' && (
          <ActivitiesPanel
            actionLogs={c.actionLogs}
            isExecuting={c.isExecuting}
            activeSkills={c.activeSkills}
            agentPrompt={c.agentPrompt}
            activeModelName={activeModelName}
            openFilesCount={c.openFiles.length}
            pinnedFilesCount={c.pinnedFiles.size}
            attachedDocsCount={c.attachedDocIds.size}
          />
        )}

        {c.activeTab === 'slm_diagnostics' && <SlmDiagnosticsPanel />}

        {c.activeTab === 'terminal' && (
          <CodingTerminal
            terminalLogs={c.terminalLogs}
            terminalInput={c.terminalInput}
            setTerminalInput={c.setTerminalInput}
            onRunCommand={c.handleRunTerminalCommand}
            onClearTerminal={c.handleClearTerminal}
            isExecuting={c.isExecuting}
            autoScroll={autoScroll}
          />
        )}

        {c.activeTab === 'git_diff' && (
          <GitDiffPanel
            gitStatusLines={c.gitStatusLines}
            gitDiffText={c.gitDiffText}
            isFetchingGit={c.isFetchingGit}
            onRefreshGit={c.fetchGitStatusAndDiff}
          />
        )}
      </div>
    </>
  )
}
