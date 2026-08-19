import React, { useEffect, useRef, useState } from 'react'
import { ArrowUp, Square, ArrowDown, RotateCcw, ClipboardList, ListPlus } from 'lucide-react'
import { IngestedDocument } from '../../types'
import { AgentMode } from './CodingAgentView'
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
  onOpenSkillHubModal?: () => void
  onOpenPromptModal?: () => void
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
  onOpenSkillHubModal,
  onOpenPromptModal,
}) => {
  const { t } = useTranslation()
  const [showToolsMenu, setShowToolsMenu] = useState(false)
  const toolsMenuRef = useRef<HTMLDivElement>(null)

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

  return (
    <div className="p-3 bg-slate-950 shrink-0">
      <div className="bg-slate-900 border border-slate-800 focus-within:border-cyan-500 focus-within:ring-1 focus-within:ring-cyan-500/30 rounded-2xl p-2.5 transition-all shadow-xl space-y-2 relative">
        {/* Top/Center: Prompt Textarea */}
        <textarea
          value={agentPrompt}
          onChange={(e) => setAgentPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          aria-label={t('coding.promptPlaceholder')}
          placeholder={t('coding.promptPlaceholder')}
          className="w-full bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-400 resize-none font-sans leading-relaxed px-1"
        />

        {/* Bottom row: [Left: Tools & Reset & Autoscroll] --- [Right: Mode selector, Complexity, Send/Stop/Queue] */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1.5 border-t border-slate-800/40">
          {/* Left: Context menu trigger + Reset + Autoscroll toggle */}
          <div className="flex items-center gap-1.5 shrink-0">
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
            />

            {/* Autoscroll Toggle Button */}
            <button
              type="button"
              onClick={onToggleAutoScroll}
              aria-label={autoScroll ? t('common.autoscrollOnAria') : t('common.autoscrollOffAria')}
              title={autoScroll ? t('common.autoscrollOnTitle') : t('common.autoscrollOffTitle')}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-all focus-ring text-[10px] font-mono font-bold cursor-pointer border ${
                autoScroll
                  ? 'text-cyan-300 bg-cyan-950/80 border-cyan-800/80 shadow-sm'
                  : 'text-slate-400 hover:text-slate-300 bg-slate-900 border-slate-800'
              }`}
            >
              <ArrowDown className={`w-3 h-3 ${autoScroll ? 'text-cyan-400' : 'text-slate-400'}`} />
              <span>Scroll: {autoScroll ? 'ON' : 'OFF'}</span>
            </button>

            {/* Reset Session Mini Icon */}
            {onResetSession && (
              <button
                type="button"
                onClick={onResetSession}
                aria-label={t('common.reset')}
                title={t('common.reset')}
                className="p-1.5 text-slate-400 hover:text-cyan-300 hover:bg-slate-800/80 rounded-lg transition-colors focus-ring"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Generate Plan Mini Icon: drafts a plan from the current prompt,
                independent of agentMode and without replacing normal send. */}
            {onGeneratePlan && (
              <button
                type="button"
                onClick={onGeneratePlan}
                disabled={!agentPrompt.trim()}
                aria-label={t('coding.generatePlanFromPrompt')}
                title={t('coding.generatePlanFromPrompt')}
                className="relative p-1.5 text-slate-400 hover:text-cyan-300 hover:bg-slate-800/80 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors focus-ring"
              >
                <ClipboardList className="w-3.5 h-3.5" />
                {hasPendingUnconsolidatedMilestones && (
                  <span
                    className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 border border-slate-900"
                    title={t('coding.pendingMilestonesBadge')}
                  />
                )}
              </button>
            )}
          </div>

          {/* Right: Quick actions, states, mode switches, complexity router, send */}
          <div className="flex items-center gap-1.5 shrink-0 min-w-0">
            <AgentModeSelector agentMode={agentMode} setAgentMode={setAgentMode} />

            {/* Action Buttons: Accoda / Send / Stop */}
            {isExecuting && (
              <button
                type="button"
                onClick={onCancel}
                aria-label={t('coding.stopTask')}
                title={t('coding.stopTask')}
                className="w-7 h-7 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center transition-all shadow-lg shadow-rose-950/50 active:scale-95 shrink-0"
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
                className="px-2.5 py-1 bg-gradient-to-r from-cyan-600 to-sky-500 hover:from-cyan-500 hover:to-sky-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold text-xs rounded-xl flex items-center gap-1 transition-all shadow-md active:scale-95 shrink-0"
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
                className="w-7 h-7 rounded-full bg-gradient-to-tr from-cyan-600 to-sky-500 hover:from-cyan-500 hover:to-sky-400 disabled:opacity-30 disabled:cursor-not-allowed text-slate-950 flex items-center justify-center transition-all shadow-md shadow-cyan-950/50 active:scale-95 shrink-0"
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
