import React, { useState } from 'react'
import {
  Activity,
  CheckCircle2,
  Clock,
  Loader2,
  Sparkles,
  Terminal,
  FileCode,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { AgentActionLog } from '../../types'
import { useTranslation } from '../../i18n'

interface ActivitiesPanelProps {
  actionLogs: AgentActionLog[]
  isExecuting: boolean
  streamingText?: string
  activeSkills?: string[]
  agentPrompt?: string
}

export const ActivitiesPanel: React.FC<ActivitiesPanelProps> = ({
  actionLogs,
  isExecuting,
  streamingText = '',
  activeSkills = [],
  agentPrompt = '',
}) => {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<'all' | 'tools' | 'terminal'>('all')
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set())

  const toggleExpand = (id: string) => {
    setExpandedLogIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Filter non-user action logs
  const agentLogs = actionLogs.filter((log) => !log.message.startsWith('User Prompt: '))

  const filteredLogs = agentLogs.filter((log) => {
    if (filter === 'tools') return log.type === 'tool_call' || log.message.includes('replace_chunk') || log.message.includes('write_file') || log.message.includes('read_file')
    if (filter === 'terminal') return log.type === 'terminal' || log.message.includes('run_command') || log.message.startsWith('Ran ')
    return true
  })

  const completedCount = agentLogs.length
  const toolCallsCount = agentLogs.filter((l) => l.type === 'tool_call' || l.message.includes('replace_chunk') || l.message.includes('write_file')).length

  return (
    <div className="flex-1 h-full flex flex-col bg-[#0b0f17] select-text font-sans text-slate-200 overflow-hidden">
      {/* Panel Top Header */}
      <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span>Attività &amp; Telemetria Agent</span>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] font-mono">
          <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/60 font-bold">
            {completedCount} Completate
          </span>
          <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/60 font-bold">
            {toolCallsCount} Tool Calls
          </span>
        </div>
      </div>

      {/* Live Active Execution Box (if running) */}
      {isExecuting && (
        <div className="m-3 p-3.5 rounded-2xl bg-gradient-to-r from-cyan-950/70 via-slate-900 to-indigo-950/70 border border-cyan-500/40 space-y-2 shadow-lg animate-in fade-in shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
              <Loader2 className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
              <span>Attività in Corso...</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono font-bold animate-pulse">
              RUNNING
            </span>
          </div>

          {agentPrompt && (
            <div className="text-xs text-slate-300 font-mono line-clamp-2 bg-slate-950/80 p-2 rounded-lg border border-slate-800">
              <span className="text-cyan-400 font-bold">Prompt: </span>
              {agentPrompt}
            </div>
          )}

          {activeSkills.length > 0 && (
            <div className="flex items-center gap-1.5 pt-1 text-[11px] text-slate-300">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="text-slate-400">Skills in uso:</span>
              <div className="flex flex-wrap gap-1">
                {activeSkills.map((sk) => (
                  <span
                    key={sk}
                    className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono text-[9px] font-bold border border-cyan-500/30"
                  >
                    {sk}
                  </span>
                ))}
              </div>
            </div>
          )}

          {streamingText && (
            <div className="mt-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-36 leading-relaxed">
              {streamingText}
            </div>
          )}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="px-3 py-2 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs shrink-0">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
          Storico Operazioni
        </span>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setFilter('all')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
              filter === 'all'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            Tutte ({agentLogs.length})
          </button>
          <button
            onClick={() => setFilter('tools')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
              filter === 'tools'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            Tool Calls ({toolCallsCount})
          </button>
          <button
            onClick={() => setFilter('terminal')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
              filter === 'terminal'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            Terminal Commands
          </button>
        </div>
      </div>

      {/* Log Feed */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 font-mono text-xs">
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2 text-slate-500 font-sans">
            <Clock className="w-8 h-8 text-cyan-500/30" />
            <div className="font-semibold text-slate-400 text-xs">Nessuna attività registrata</div>
            <p className="text-[11px] max-w-xs text-slate-500">
              Le operazioni eseguite dall'AI Agent appariranno in questo registro in tempo reale.
            </p>
          </div>
        ) : (
          filteredLogs.map((log) => {
            const isExpanded = expandedLogIds.has(log.id)
            const isTerminal = log.type === 'terminal' || log.message.includes('run_command')
            const isTool = log.type === 'tool_call' || log.message.includes('replace_chunk') || log.message.includes('write_file')

            return (
              <div
                key={log.id}
                className="p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 space-y-1.5 hover:border-slate-700 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 truncate">
                    {isTerminal ? (
                      <Terminal className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    ) : isTool ? (
                      <FileCode className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    )}
                    <span className="font-bold text-slate-200 truncate">{log.message}</span>
                  </div>
                  <span className="text-[10px] text-slate-500 shrink-0 ml-2">{log.timestamp}</span>
                </div>

                {log.detail && (
                  <div>
                    <button
                      onClick={() => toggleExpand(log.id)}
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-mono font-semibold"
                    >
                      {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      {isExpanded ? t('common.close') : 'Visualizza Dettaglio'}
                    </button>
                    {isExpanded && (
                      <pre className="mt-1.5 p-2.5 bg-slate-950 rounded-lg border border-slate-800 text-[10px] text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-52 leading-relaxed">
                        {log.detail}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
