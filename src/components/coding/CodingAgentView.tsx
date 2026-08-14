import React, { useState, useRef } from 'react'
import Editor, { DiffEditor } from '@monaco-editor/react'
import {
  FileCode2,
  Paperclip,
  FolderOpen,
  GitBranch,
  RefreshCw,
  Save,
  Terminal,
  GripVertical,
  ChevronRight,
  Copy,
  Check,
  Split,
  Plus,
  X,
  Code2,
  PanelLeft,
} from 'lucide-react'
import { AppSettings, WorkspaceFile, DiagnosticsData } from '../../types'
import { SystemPromptModal } from '../common/SystemPromptModal'
import { FileTreeNode } from './FileExplorerTree'
import { AgentActionLogPanel } from './AgentActionLogPanel'
import { GitDiffPanel } from './GitDiffPanel'
import { CodingTerminal } from './CodingTerminal'
import { useCodingAgent } from '../../hooks/useCodingAgent'
import { CodingHeader } from './CodingHeader'
import { PendingApprovalModal } from './PendingApprovalModal'
import { SkillHubModal } from './SkillHubModal'
import { useTranslation } from '../../i18n'

export type AgentMode = 'plan' | 'ask' | 'agent'

interface CodingAgentViewProps {
  settings?: AppSettings
  onUpdateSettings?: (newSettings: Partial<AppSettings>) => void
  diagnostics?: DiagnosticsData | null
}

export const CodingAgentView: React.FC<CodingAgentViewProps> = ({ settings, onUpdateSettings, diagnostics }) => {
  const { t } = useTranslation()
  const c = useCodingAgent(settings)
  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(460)
  const [showWorkspaceSidebar, setShowWorkspaceSidebar] = useState<boolean>(false)
  const [isDiffMode, setIsDiffMode] = useState<boolean>(false)
  const [copiedPath, setCopiedPath] = useState<boolean>(false)
  const [isSkillHubOpen, setIsSkillHubOpen] = useState<boolean>(false)
  const isDraggingRef = useRef(false)

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingRef.current = true

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return
      const newWidth = moveEvent.clientX - (showWorkspaceSidebar ? 240 : 64)
      if (newWidth >= 320 && newWidth <= 750) {
        setLeftPanelWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      isDraggingRef.current = false
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const getLanguageFromExtension = (filename?: string) => {
    if (!filename) return 'typescript'
    if (filename.endsWith('.tsx') || filename.endsWith('.ts')) return 'typescript'
    if (filename.endsWith('.json')) return 'json'
    if (filename.endsWith('.py')) return 'python'
    if (filename.endsWith('.css')) return 'css'
    if (filename.endsWith('.html')) return 'html'
    if (filename.endsWith('.md')) return 'markdown'
    return 'plaintext'
  }

  const handleCopyPath = () => {
    if (c.selectedFile?.path) {
      navigator.clipboard.writeText(c.selectedFile.path)
      setCopiedPath(true)
      setTimeout(() => setCopiedPath(false), 2000)
    }
  }

  const getBreadcrumbParts = (filePath?: string) => {
    if (!filePath) return [t('common.noFileOpen')]
    const normalized = filePath.replace(/\\/g, '/')
    const parts = normalized.split('/').filter(Boolean)
    return parts.length > 5 ? ['...', ...parts.slice(-4)] : parts
  }

  return (
    <div className="flex-1 h-full flex flex-col bg-[#0b0f17] overflow-hidden select-text">
      {/* Antigravity Top Header Bar */}
      <CodingHeader
        guestOsInfo={c.guestOsInfo}
        settings={settings}
        agentPrompt={c.agentPrompt}
        pinnedFilesCount={c.pinnedFiles.size}
        editorContentLength={c.editorContent.length}
        activeSkills={c.activeSkills}
        availableModels={diagnostics?.ollama.models}
      />

      {/* Main Workspace Split Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Optional Collapsible Left Sidebar: Project File Explorer */}
        {showWorkspaceSidebar && (
          <div className="w-60 border-r border-slate-800/80 bg-[#0d121d] flex flex-col shrink-0 z-20 transition-all">
            <div className="p-3 border-b border-slate-800/80 flex items-center justify-between text-xs font-semibold text-slate-300">
              <span className="flex items-center gap-1.5 text-cyan-400">
                <FolderOpen className="w-3.5 h-3.5" /> {t('coding.filesTitle')}
              </span>
              <button
                onClick={() => setShowWorkspaceSidebar(false)}
                aria-label={t('common.close')}
                className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-md"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="p-2 border-b border-slate-800/60 flex items-center gap-1.5">
              <button
                onClick={c.handleSelectWorkspaceFolder}
                className="flex-1 py-1 px-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-slate-300 text-[11px] font-medium truncate text-left"
              >
                {c.workspacePath ? c.workspacePath.split(/[\\/]/).pop() : t('coding.selectFolderBtn')}
              </button>
              <button
                onClick={() => c.loadWorkspaceFiles(c.workspacePath)}
                disabled={!c.workspacePath}
                aria-label={t('common.refresh')}
                title={t('common.refresh')}
                className="p-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-30 border border-slate-800 text-slate-400 hover:text-cyan-400 rounded-lg"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-xs">
              {c.files.map((file) => (
                <FileTreeNode
                  key={file.path}
                  item={file}
                  level={0}
                  selectedFilePath={c.selectedFile?.path || null}
                  pinnedPaths={new Set(c.pinnedFiles.keys())}
                  onOpenFile={c.handleOpenFile}
                  onTogglePinFile={c.handleTogglePinFile}
                />
              ))}
            </div>
          </div>
        )}

        {/* Left Column: Antigravity Interactive Timeline & Prompt Composer */}
        <div style={{ width: `${leftPanelWidth}px` }} className="flex flex-col border-r border-slate-800/80 bg-[#0b0f17] shrink-0 overflow-hidden">
          {/* Sub-toolbar: Workspace trigger & conversation status */}
          <div className="px-3 py-2 border-b border-slate-800/80 bg-[#0d121d]/80 flex items-center justify-between text-xs shrink-0">
            <button
              onClick={() => setShowWorkspaceSidebar(!showWorkspaceSidebar)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition-colors ${
                showWorkspaceSidebar
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/80'
                  : 'bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <PanelLeft className="w-3.5 h-3.5" />
              <span>{t('coding.filesTab')} ({c.files.length})</span>
            </button>

            <span className="text-[11px] font-mono text-slate-500">
              {t('coding.stepsCount', { count: c.actionLogs.length })}
            </span>
          </div>

          <div className="flex-1 overflow-hidden">
            <AgentActionLogPanel
              actionLogs={c.actionLogs}
              agentMode={c.agentMode}
              setAgentMode={c.setAgentMode}
              agentPrompt={c.agentPrompt}
              setAgentPrompt={c.setAgentPrompt}
              isExecuting={c.isExecuting}
              activeSkills={c.activeSkills}
              streamingText={c.streamingText}
              onExecute={c.handleAgentExecute}
              onCancel={c.handleCancelAgent}
              pinnedFiles={c.pinnedFiles}
              ingestedDocs={c.ingestedDocs}
              attachedDocIds={c.attachedDocIds}
              onToggleAttachDoc={c.toggleAttachDoc}
              selectedFile={c.selectedFile}
              activeModelName={settings?.codingModel || settings?.defaultModel || 'qwen2.5-coder:7b'}
              settings={settings}
              availableModels={diagnostics?.ollama.models}
              onOpenFile={c.handleOpenFile}
              promptQueue={c.promptQueue}
              onRemoveFromQueue={c.removeFromPromptQueue}
              onEditPromptInQueue={c.editPromptInQueue}
              onOpenPromptModal={() => c.setIsPromptModalOpen(true)}
              onOpenSkillHubModal={() => setIsSkillHubOpen(true)}
              onResetSession={c.handleNewSession}
            />
          </div>
        </div>

        {/* Resizable Divider Handle */}
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-valuenow={leftPanelWidth}
          aria-valuemin={320}
          aria-valuemax={750}
          onMouseDown={handleMouseDown}
          className="w-1 hover:w-1.5 hover:bg-cyan-500 bg-slate-800/80 cursor-col-resize transition-all shrink-0 flex items-center justify-center group"
          title={t('coding.resizePanels')}
        >
          <GripVertical className="w-3 h-3 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>

        {/* Right Column: Multi-tab Monaco Code & Diff Editor */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#0e131f] min-w-[350px]">
          {/* Top Editor Tab Bar */}
          <div className="bg-[#0b0f17] border-b border-slate-800/80 px-2 pt-1 flex items-center justify-between text-xs shrink-0 overflow-x-auto select-none">
            <div className="flex items-center gap-1 overflow-x-auto py-0.5">
              {/* File Tabs */}
              {c.openFiles.map((file) => {
                const isActive = c.activeTab === 'editor' && c.selectedFile?.path === file.path
                const isDirty = isActive && !c.isSaved
                return (
                  <div
                    key={file.path}
                    onClick={() => c.handleOpenFile(file)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-t-lg font-mono text-xs cursor-pointer transition-all border-x border-slate-800/80 ${
                      isActive
                        ? 'bg-[#161c28] border-t-2 border-t-cyan-400 text-slate-100 font-bold shadow-md'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border-t-2 border-transparent'
                    }`}
                  >
                    <FileCode2 className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-cyan-400' : 'text-slate-500'}`} />
                    <span className="truncate max-w-[140px]">{file.name}</span>
                    {isDirty && <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" title={t('coding.dirtyBadge')} />}
                    <button
                      onClick={(e) => c.handleCloseFile(file, e)}
                      className="p-0.5 hover:bg-slate-700/80 hover:text-slate-100 text-slate-500 rounded transition-colors"
                      title={t('common.close')}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )
              })}

              {c.openFiles.length === 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-[#161c28] border-t-2 border-t-cyan-400 border-x border-slate-800/80 rounded-t-lg text-slate-400 font-mono text-xs">
                  <FileCode2 className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{t('coding.noFilesOpen')}</span>
                </div>
              )}

              {/* Utility Tabs: Terminal & Git Diff */}
              <button
                onClick={() => c.setActiveTab('terminal')}
                className={`px-3 py-1.5 rounded-t-lg font-medium transition-colors flex items-center gap-1.5 border-t-2 ${
                  c.activeTab === 'terminal'
                    ? 'bg-[#161c28] text-cyan-300 border-t-cyan-400 font-bold shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border-transparent'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" /> {t('coding.terminalTab')}
              </button>

              <button
                onClick={() => {
                  c.setActiveTab('git_diff')
                  c.fetchGitStatusAndDiff()
                }}
                className={`px-3 py-1.5 rounded-t-lg font-medium transition-colors flex items-center gap-1.5 border-t-2 ${
                  c.activeTab === 'git_diff'
                    ? 'bg-[#161c28] text-cyan-300 border-t-cyan-400 font-bold shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border-transparent'
                }`}
              >
                <GitBranch className="w-3.5 h-3.5" /> {t('coding.gitDiffTab')}
              </button>
            </div>

            {/* Right Editor Controls: Save, Diff Split, Copy Path */}
            <div className="flex items-center gap-1.5 pb-1">
              {c.selectedFile && c.activeTab === 'editor' && (
                <>
                  <button
                    onClick={() => setIsDiffMode(!isDiffMode)}
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
                    onClick={c.handleSaveFile}
                    disabled={c.isSaved}
                    aria-label={t('coding.saveButton')}
                    className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-30 text-slate-950 font-bold text-xs rounded-lg transition-colors flex items-center gap-1 shadow-md shadow-cyan-950/40"
                  >
                    <Save className="w-3 h-3" /> {t('coding.saveButton')}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Breadcrumbs Navigation Bar */}
          {c.selectedFile && c.activeTab === 'editor' && (
            <div className="px-4 py-1.5 bg-[#0e131f] border-b border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400 shrink-0">
              <div className="flex items-center gap-1 truncate">
                {getBreadcrumbParts(c.selectedFile.path).map((part, idx, arr) => (
                  <React.Fragment key={idx}>
                    <span className={idx === arr.length - 1 ? 'text-slate-200 font-semibold' : 'text-slate-500'}>
                      {part}
                    </span>
                    {idx < arr.length - 1 && <ChevronRight className="w-3 h-3 text-slate-700 shrink-0" />}
                  </React.Fragment>
                ))}
              </div>

              <button
                onClick={handleCopyPath}
                aria-label={t('coding.copyPath')}
                className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
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
                      wordWrap: 'on',
                      lineNumbers: 'on',
                    }}
                  />
                )
              ) : (
                <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-3 text-slate-500 font-sans">
                  <FileCode2 className="w-10 h-10 text-cyan-500/40" />
                  <div className="text-slate-300 font-semibold text-sm">{t('coding.noFilesOpen')}</div>
                  <p className="text-xs text-slate-400 max-w-sm">
                    {t('coding.emptyLogs')}
                  </p>
                  <button
                    onClick={() => setShowWorkspaceSidebar(true)}
                    className="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded-xl text-xs transition-colors"
                  >
                    {t('coding.filesTab')}
                  </button>
                </div>
              )
            )}

            {c.activeTab === 'terminal' && (
              <CodingTerminal
                terminalLogs={c.terminalLogs}
                terminalInput={c.terminalInput}
                setTerminalInput={c.setTerminalInput}
                onRunCommand={c.handleRunTerminalCommand}
                onClearTerminal={c.handleClearTerminal}
                isExecuting={c.isExecuting}
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
        </div>
      </div>

      {/* Pending Approval Modal (Ask Mode) */}
      <PendingApprovalModal
        pendingApproval={c.pendingApproval}
        onApprove={c.handleApproveAction}
        onReject={() => c.setPendingApproval(null)}
      />

      {/* System Prompt Customization Modal */}
      {settings && onUpdateSettings && (
        <SystemPromptModal
          isOpen={c.isPromptModalOpen}
          onClose={() => c.setIsPromptModalOpen(false)}
          module="coding"
          moduleTitle={t('coding.title')}
          activeModelName={settings.codingModel || settings.defaultModel || 'qwen2.5-coder:7b'}
          settings={settings}
          onUpdateSettings={onUpdateSettings}
        />
      )}

      {/* Skill Hub & Marketplace Modal */}
      <SkillHubModal
        isOpen={isSkillHubOpen}
        onClose={() => setIsSkillHubOpen(false)}
        workspacePath={c.workspacePath}
      />
    </div>
  )
}
