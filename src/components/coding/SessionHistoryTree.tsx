import React, { useState } from 'react'
import {
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Edit2,
  Folder,
  Loader2,
  MessageSquare,
  Trash2,
  XCircle,
} from 'lucide-react'
import { CodingSession, ExecutedPrompt, ExecutedPromptOutcome } from '../../types'
import { formatDateTime } from '../../lib/timeFormat'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n/I18nContext'

interface SessionHistoryTreeProps {
  projectName: string
  sessions: CodingSession[]
  activeSessionId?: string
  onSwitchSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onRenameSession: (id: string, title: string) => void
}

export const OUTCOME_STYLES: Record<ExecutedPromptOutcome, { icon: React.ElementType; className: string; labelKey: TranslationKey }> = {
  running: { icon: Loader2, className: 'text-cyan-400 animate-spin', labelKey: 'coding.outcomeRunning' },
  success: { icon: CheckCircle2, className: 'text-emerald-400', labelKey: 'coding.outcomeSuccess' },
  failed: { icon: XCircle, className: 'text-rose-400', labelKey: 'coding.outcomeFailed' },
  cancelled: { icon: Ban, className: 'text-amber-400', labelKey: 'coding.outcomeCancelled' },
  unknown: { icon: CircleDashed, className: 'text-slate-500', labelKey: 'coding.outcomeUnknown' },
}

const ExecutedPromptRow: React.FC<{ executedPrompt: ExecutedPrompt }> = ({ executedPrompt }) => {
  const { t } = useTranslation()
  const outcome = OUTCOME_STYLES[executedPrompt.outcome] || OUTCOME_STYLES.unknown
  const OutcomeIcon = outcome.icon

  return (
    <div className="pl-6 pr-1 py-1 rounded-lg hover:bg-slate-900/70 text-[10px] text-slate-300">
      <div className="flex items-start gap-1.5">
        <OutcomeIcon className={`w-3 h-3 mt-0.5 shrink-0 ${outcome.className}`} aria-label={t(outcome.labelKey)} />
        <span className="truncate" title={executedPrompt.prompt}>
          {executedPrompt.prompt}
        </span>
      </div>
      <div className="pl-4.5 font-mono text-[9px] text-slate-500 flex flex-wrap gap-x-2">
        <span>{formatDateTime(executedPrompt.startedAt)}</span>
        <span className="uppercase text-indigo-400/80">{executedPrompt.agentMode}</span>
        <span>{t('coding.historyStepsLabel', { count: executedPrompt.totalSteps })}</span>
        <span>{t('coding.historyFilesLabel', { count: executedPrompt.filesTouched })}</span>
        <span className="text-emerald-400">+{executedPrompt.additions}</span>
        <span className="text-rose-400">-{executedPrompt.deletions}</span>
      </div>
    </div>
  )
}

/**
 * Session history rendered as a project > session > executed prompts tree.
 * Every session node lists the prompts actually executed in it, with the
 * outcome and change metrics recorded for each run.
 */
export const SessionHistoryTree: React.FC<SessionHistoryTreeProps> = ({
  projectName,
  sessions,
  activeSessionId,
  onSwitchSession,
  onDeleteSession,
  onRenameSession,
}) => {
  const { t } = useTranslation()
  const [isProjectExpanded, setIsProjectExpanded] = useState<boolean>(true)
  const [expandedSessionIds, setExpandedSessionIds] = useState<Set<string>>(new Set(activeSessionId ? [activeSessionId] : []))
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitleText, setEditingTitleText] = useState<string>('')

  const toggleSession = (sessionId: string) => {
    setExpandedSessionIds((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

  const commitRename = (sessionId: string) => {
    onRenameSession(sessionId, editingTitleText)
    setEditingSessionId(null)
  }

  return (
    <div className="space-y-0.5" role="tree">
      <button
        type="button"
        onClick={() => setIsProjectExpanded((prev) => !prev)}
        className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded-lg text-[11px] font-bold text-slate-200 hover:bg-slate-900"
      >
        {isProjectExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
        <Folder className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
        <span className="truncate">{projectName}</span>
        <span className="ml-auto text-[9px] font-mono text-slate-500">{t('coding.historySessionsCount', { count: sessions.length })}</span>
      </button>

      {isProjectExpanded &&
        sessions.map((session) => {
          const isActive = session.id === activeSessionId
          const isExpanded = expandedSessionIds.has(session.id)
          const isEditing = editingSessionId === session.id

          return (
            <div key={session.id} className="pl-3">
              <div
                className={`flex items-center gap-1 px-1.5 py-1 rounded-lg group border ${
                  isActive ? 'bg-indigo-950/70 border-indigo-500/40 text-indigo-200' : 'border-transparent text-slate-300 hover:bg-slate-900'
                }`}
              >
                <button type="button" onClick={() => toggleSession(session.id)} aria-label={t('coding.historyExpandSession')} className="p-0.5 text-slate-400 hover:text-slate-200">
                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>

                {isEditing ? (
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <input
                      type="text"
                      value={editingTitleText}
                      onChange={(e) => setEditingTitleText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(session.id)
                        else if (e.key === 'Escape') setEditingSessionId(null)
                      }}
                      className="flex-1 bg-slate-950 border border-indigo-500 rounded px-2 py-0.5 text-[11px] text-slate-100 outline-none"
                      autoFocus
                    />
                    <button type="button" onClick={() => commitRename(session.id)} className="p-1 text-emerald-400 hover:bg-slate-800 rounded">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <button type="button" onClick={() => onSwitchSession(session.id)} className="flex items-center gap-1.5 text-left truncate flex-1 min-w-0">
                      <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                      <span className="truncate min-w-0">
                        <span className="block font-semibold truncate text-[11px]">{session.title}</span>
                        <span className="block text-[9px] font-mono text-slate-500">
                          {formatDateTime(session.updatedAt || session.createdAt)} • {t('coding.historyPromptsCount', { count: session.executedPrompts.length })}
                        </span>
                      </span>
                    </button>

                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSessionId(session.id)
                          setEditingTitleText(session.title)
                        }}
                        title={t('common.edit')}
                        className="p-1 hover:text-cyan-300 rounded"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      {sessions.length > 1 && (
                        <button type="button" onClick={() => onDeleteSession(session.id)} title={t('common.delete')} className="p-1 hover:text-rose-400 rounded">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>

              {isExpanded && (
                <div className="pl-3 border-l border-slate-800 ml-2">
                  {session.executedPrompts.length === 0 ? (
                    <div className="pl-3 py-1 text-[10px] text-slate-500">{t('coding.historyNoPrompts')}</div>
                  ) : (
                    session.executedPrompts.map((executedPrompt) => (
                      <ExecutedPromptRow key={executedPrompt.id} executedPrompt={executedPrompt} />
                    ))
                  )}
                </div>
              )}
            </div>
          )
        })}
    </div>
  )
}
