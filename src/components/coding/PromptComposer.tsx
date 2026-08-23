import React, { useEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  Square,
  ArrowDown,
  RotateCcw,
  ClipboardList,
  ListPlus,
  Pin,
  X,
  FileText,
  Minimize2,
  Layers,
  Sparkles,
} from 'lucide-react'
import { IngestedDocument, WorkspaceFile, AgentChangeMetrics, AgentMode } from '../../types'
import type { QueuedPrompt } from '../../hooks/useCodingAgent'
import { useTranslation } from '../../i18n'
import { PromptComposerToolsMenu } from './PromptComposerToolsMenu'
import { AgentModeSelector } from './AgentModeSelector'

interface PromptComposerProps {
  agentPrompt: string
  setAgentPrompt: (prompt: string) => void
  onExecute: () => void
  onCancel: () => void
  isExecuting: boolean
  queueLength: number
  agentMode: AgentMode
  setAgentMode: (mode: AgentMode) => void
  autoScroll: boolean
  onToggleAutoScroll: () => void
  onResetSession?: () => void
  onGeneratePlan?: () => void
  hasPendingUnconsolidatedMilestones: boolean
  ingestedDocs: IngestedDocument[]
  attachedDocIds: Set<string>
  onToggleAttachDoc: (docId: string) => void
  pinnedFiles?: Map<string, WorkspaceFile>
  onTogglePinFile?: (file: WorkspaceFile) => void
  onOpenSkillHubModal?: () => void
  onOpenPromptModal?: () => void
  onOpenDiagnosticsModal?: () => void
  onOpenPromptHistorySearch?: () => void
  promptQueue?: QueuedPrompt[]
  onRemoveFromQueue?: (id: string) => void
  onEditPromptInQueue?: (id: string, newPrompt: string) => void
  changeMetrics?: AgentChangeMetrics
  contextPercent?: number
  estimatedTurnTokens?: number
  maxContextLimit?: number
  isContextHeavy?: boolean
  onCompactContext?: () => void
  autoInstallHubSkills?: 'disabled' | 'prompt' | 'auto'
  onToggleAutoInstallSkills?: () => void
}

export const PromptComposer: React.FC<PromptComposerProps> = ({
  agentPrompt,
  setAgentPrompt,
  onExecute,
  onCancel,
  isExecuting,
  queueLength,
  agentMode,
  setAgentMode,
  autoScroll,
  onToggleAutoScroll,
  onResetSession,
  onGeneratePlan,
  hasPendingUnconsolidatedMilestones,
  ingestedDocs,
  attachedDocIds,
  onToggleAttachDoc,
  pinnedFiles = new Map(),
  onTogglePinFile,
  onOpenSkillHubModal,
  onOpenPromptModal,
  onOpenDiagnosticsModal,
  onOpenPromptHistorySearch,
  promptQueue = [],
  onRemoveFromQueue,
  changeMetrics,
  contextPercent = 0,
  estimatedTurnTokens = 0,
  maxContextLimit = 0,
  isContextHeavy = false,
  onCompactContext,
  autoInstallHubSkills = 'auto',
  onToggleAutoInstallSkills,
}) => {
  const { t } = useTranslation()
  const [showToolsMenu, setShowToolsMenu] = useState(false)
  const toolsMenuRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea based on content
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      const newHeight = Math.min(Math.max(textareaRef.current.scrollHeight, 40), 160)
      textareaRef.current.style.height = `${newHeight}px`
    }
  }, [agentPrompt])

  // Close tools popover on click outside or Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setShowToolsMenu(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowToolsMenu(false)
      }
    }
    if (showToolsMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showToolsMenu])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (agentPrompt.trim()) {
        onExecute()
      }
    }
  }

  const pinnedFilesArray = Array.from(pinnedFiles.values())
  const attachedDocsArray = ingestedDocs.filter((d) => attachedDocIds.has(d.id))
  const hasContextPills = pinnedFilesArray.length > 0 || attachedDocsArray.length > 0
  const hasChanges = (changeMetrics?.filesTouched || 0) > 0

  return (
    <div className="p-3 bg-slate-950 shrink-0 space-y-2 select-text font-sans">
      {/* Floating Prompt Queue Strip */}
      {promptQueue.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto py-1 px-2 bg-slate-900/90 border border-slate-800 rounded-xl text-xs">
          <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider shrink-0 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-cyan-400" />
            Coda ({promptQueue.length}):
          </span>
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
            {promptQueue.map((item, idx) => (
              <span
                key={item.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 font-mono text-[10px] shrink-0"
              >
                <span className="text-cyan-400 font-bold">#{idx + 1}</span>
                <span className="truncate max-w-[140px]">{item.prompt}</span>
                {onRemoveFromQueue && (
                  <button
                    type="button"
                    onClick={() => onRemoveFromQueue(item.id)}
                    className="p-0.5 hover:text-rose-400 text-slate-500 rounded cursor-pointer"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Main Composer Box */}
      <div className="bg-slate-900/90 border border-slate-800 focus-within:border-cyan-500/50 focus-within:ring-1 focus-within:ring-cyan-500/20 rounded-2xl p-2.5 transition-all shadow-lg space-y-2 relative">
        {/* Context Pills (Pinned files & Attached RAG docs) */}
        {hasContextPills && (
          <div className="flex flex-wrap gap-1.5 pb-1 border-b border-slate-800/50">
            {pinnedFilesArray.map((file) => (
              <span
                key={file.path}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-cyan-950/40 border border-cyan-800/50 text-cyan-300 text-[10px] font-mono shadow-sm"
                title={file.path}
              >
                <Pin className="w-2.5 h-2.5" />
                <span className="truncate max-w-[120px]">{file.name}</span>
                {onTogglePinFile && (
                  <button
                    type="button"
                    onClick={() => onTogglePinFile(file)}
                    aria-label={`Rimuovi ${file.name} dal contesto`}
                    className="hover:text-rose-400 p-0.5 transition-colors cursor-pointer focus-ring rounded"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </span>
            ))}

            {attachedDocsArray.map((doc) => (
              <span
                key={doc.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 text-[10px] font-mono shadow-sm"
                title={doc.filename}
              >
                <FileText className="w-2.5 h-2.5" />
                <span className="truncate max-w-[120px]">{doc.filename}</span>
                <button
                  type="button"
                  onClick={() => onToggleAttachDoc(doc.id)}
                  aria-label={`Rimuovi allegato ${doc.filename}`}
                  className="hover:text-rose-400 p-0.5 transition-colors cursor-pointer focus-ring rounded"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Prompt Textarea */}
        <textarea
          ref={textareaRef}
          value={agentPrompt}
          onChange={(e) => setAgentPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          aria-label={t('coding.promptPlaceholder')}
          placeholder={t('coding.promptPlaceholder')}
          className="w-full bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-500 resize-none font-sans leading-relaxed px-1 min-h-[38px] max-h-[160px]"
        />

        {/* Bottom Bar: [Left Tools] --- [Center Context Gauge] --- [Right Mode & Actions] */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1.5 border-t border-slate-800/40">
          {/* Left: Tools popover trigger, Plan generation & Reset */}
          <div className="flex items-center gap-1 shrink-0">
            <PromptComposerToolsMenu
              isOpen={showToolsMenu}
              onToggle={() => setShowToolsMenu(!showToolsMenu)}
              onClose={() => setShowToolsMenu(false)}
              menuRef={toolsMenuRef}
              ingestedDocs={ingestedDocs}
              attachedDocIds={attachedDocIds}
              onToggleAttachDoc={onToggleAttachDoc}
              onOpenSkillHubModal={onOpenSkillHubModal}
              onOpenPromptModal={onOpenPromptModal}
              onOpenDiagnosticsModal={onOpenDiagnosticsModal}
              onOpenPromptHistorySearch={onOpenPromptHistorySearch}
              autoInstallHubSkills={autoInstallHubSkills}
              onToggleAutoInstallSkills={onToggleAutoInstallSkills}
            />

            {/* Autoscroll Toggle Mini Button */}
            <button
              type="button"
              onClick={onToggleAutoScroll}
              aria-label={autoScroll ? t('common.autoscrollOnAria') : t('common.autoscrollOffAria')}
              title={autoScroll ? t('common.autoscrollOnTitle') : t('common.autoscrollOffTitle')}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer focus-ring ${
                autoScroll
                  ? 'text-cyan-400 bg-cyan-950/60 border border-cyan-800/60'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/60'
              }`}
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>

            {/* Reset Session Icon */}
            {onResetSession && (
              <button
                type="button"
                onClick={onResetSession}
                aria-label={t('common.reset')}
                title={t('common.reset')}
                className="p-1.5 text-slate-500 hover:text-cyan-300 hover:bg-slate-800/60 rounded-lg transition-colors cursor-pointer focus-ring"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Generate Plan Icon */}
            {onGeneratePlan && (
              <button
                type="button"
                onClick={onGeneratePlan}
                disabled={!agentPrompt.trim()}
                aria-label={t('coding.generatePlanFromPrompt')}
                title={t('coding.generatePlanFromPrompt')}
                className="relative p-1.5 text-slate-500 hover:text-cyan-300 hover:bg-slate-800/60 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition-colors cursor-pointer focus-ring"
              >
                <ClipboardList className="w-3.5 h-3.5" />
                {hasPendingUnconsolidatedMilestones && (
                  <span
                    className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-amber-400 border border-slate-900"
                    title={t('coding.pendingMilestonesBadge')}
                  />
                )}
              </button>
            )}
          </div>

          {/* Center: Context & Metrics Status Pill */}
          <div className="hidden sm:flex items-center gap-2 text-[10px] font-mono text-slate-400">
            {hasChanges && (
              <span className="flex items-center gap-1 text-slate-300">
                <Layers className="w-3 h-3 text-cyan-400" />
                <span>{changeMetrics?.filesTouched}f</span>
                <span className="text-emerald-400">+{changeMetrics?.additions}</span>
                <span className="text-rose-400">-{changeMetrics?.deletions}</span>
              </span>
            )}

            <span className={`flex items-center gap-1 ${isContextHeavy ? 'text-amber-300 font-bold' : 'text-slate-400'}`} title={`${estimatedTurnTokens}/${maxContextLimit} tokens stimati`}>
              <span>Ctx: {contextPercent}%</span>
              {isContextHeavy && onCompactContext && (
                <button
                  type="button"
                  onClick={onCompactContext}
                  title="Compatta il contesto della sessione"
                  aria-label="Compatta il contesto della sessione"
                  className="p-0.5 rounded bg-amber-950 text-amber-300 border border-amber-700/60 hover:bg-amber-900 cursor-pointer focus-ring"
                >
                  <Minimize2 className="w-2.5 h-2.5" />
                </button>
              )}
            </span>
          </div>

          {/* Right: Mode Selector + Action Buttons (Send / Stop / Queue) */}
          <div className="flex items-center gap-1.5 shrink-0 min-w-0">
            <AgentModeSelector agentMode={agentMode} setAgentMode={setAgentMode} />

            {/* Action Buttons: Accoda / Send / Stop */}
            {isExecuting && (
              <button
                type="button"
                onClick={onCancel}
                aria-label={t('coding.stopTask')}
                title={t('coding.stopTask')}
                className="w-7 h-7 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center transition-all shadow-lg shadow-rose-950/50 active:scale-95 shrink-0 cursor-pointer focus-ring"
              >
                <Square className="w-3 h-3 fill-current" />
              </button>
            )}

            {isExecuting ? (
              <button
                type="button"
                onClick={() => onExecute()}
                disabled={!agentPrompt.trim()}
                aria-label={t('coding.queuedPrompts', { count: queueLength })}
                title={t('coding.queuedPrompts', { count: queueLength })}
                className="px-2.5 py-1 bg-gradient-to-r from-cyan-600 to-sky-500 hover:from-cyan-500 hover:to-sky-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold text-xs rounded-xl flex items-center gap-1 transition-all shadow-md active:scale-95 shrink-0 cursor-pointer focus-ring"
              >
                <ListPlus className="w-3.5 h-3.5" />
                <span className="text-[11px]">+</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onExecute()}
                disabled={!agentPrompt.trim()}
                aria-label={t('coding.runTask')}
                title={t('coding.runTask')}
                className="w-7 h-7 rounded-full bg-gradient-to-tr from-cyan-600 to-sky-500 hover:from-cyan-500 hover:to-sky-400 disabled:opacity-30 disabled:cursor-not-allowed text-slate-950 flex items-center justify-center transition-all shadow-md shadow-cyan-950/50 active:scale-95 shrink-0 cursor-pointer focus-ring"
              >
                <ArrowUp className="w-3.5 h-3.5 font-bold" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
