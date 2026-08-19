import React, { useState } from 'react'
import { Code2, Loader2, ArrowDown } from 'lucide-react'
import { AgentActionLog, WorkspaceFile, CodingSession } from '../../types'
import { useTranslation } from '../../i18n'
import { AgentTimelineMessage } from './AgentTimelineMessage'

interface AgentTimelineProps {
  actionLogs: AgentActionLog[]
  activeSession?: CodingSession | null
  setAgentPrompt: (prompt: string) => void
  activeModelName?: string
  onOpenFile?: (file: WorkspaceFile) => void
  isExecuting: boolean
  streamingText: string
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  bottomRef: React.RefObject<HTMLDivElement | null>
  isScrolledUp: boolean
  onScroll: () => void
  onScrollToBottom: () => void
}

export const AgentTimeline: React.FC<AgentTimelineProps> = ({
  actionLogs,
  activeSession,
  setAgentPrompt,
  activeModelName,
  onOpenFile,
  isExecuting,
  streamingText,
  scrollContainerRef,
  bottomRef,
  isScrolledUp,
  onScroll,
  onScrollToBottom,
}) => {
  const { t } = useTranslation()
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set())

  const toggleExpand = (id: string) => {
    setExpandedLogIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div
      ref={scrollContainerRef}
      onScroll={onScroll}
      className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs font-mono relative"
    >
      {/* Floating Scroll-to-Bottom Button */}
      {isScrolledUp && (
        <button
          type="button"
          onClick={onScrollToBottom}
          className="sticky bottom-2 ml-auto z-20 px-3 py-1.5 rounded-full bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs shadow-xl flex items-center gap-1.5 transition-all active:scale-95"
          aria-label="Scorri fino in fondo"
        >
          <ArrowDown className="w-3.5 h-3.5" />
          <span>In fondo</span>
        </button>
      )}

      {actionLogs.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3 text-slate-400 font-sans select-none">
          <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 mb-1 shadow-lg shadow-cyan-950/20">
            <Code2 className="w-6 h-6" />
          </div>
          <div>
            <div className="font-semibold text-slate-200 text-sm">{activeSession?.title || t('coding.headerTitle')}</div>
            <p className="text-xs max-w-xs leading-relaxed text-slate-400 mt-1">
              {t('coding.subtitle')}
            </p>
          </div>

          <div className="w-full pt-3 space-y-1.5 text-left font-sans">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider text-center">
              {t('common.actions')}
            </div>
            <div className="flex flex-col gap-1.5">
              {[
                'npm run test:fast',
                'npm run typecheck',
                'git status',
              ].map((quickTask, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setAgentPrompt(quickTask)}
                  className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/40 text-[11px] text-slate-300 hover:text-cyan-200 transition-all text-left focus-ring active:scale-98 font-mono"
                >
                  {quickTask}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        actionLogs.map((log) => (
          <AgentTimelineMessage
            key={log.id}
            log={log}
            isExpanded={expandedLogIds.has(log.id)}
            onToggleExpand={toggleExpand}
            activeModelName={activeModelName}
            onOpenFile={onOpenFile}
          />
        ))
      )}

      {isExecuting && (
        <div className="p-3 rounded-2xl bg-[#111827] border border-slate-800 space-y-2 text-xs text-cyan-300 font-sans shadow-lg animate-in fade-in duration-150">
          <div className="flex items-center gap-2.5">
            <Loader2 className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
            <span className="font-semibold text-slate-200">{t('coding.runTask')}...</span>
          </div>
          {streamingText && (
            <div className="mt-2 p-2.5 rounded-xl bg-slate-950/90 border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-48 leading-relaxed shadow-inner">
              {streamingText}
            </div>
          )}
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
