import React from 'react'
import { ChevronDown, ChevronRight, User, Bot, AlertTriangle } from 'lucide-react'
import { AgentActionLog, WorkspaceFile } from '../../types'
import { formatClockTime } from '../../lib/timeFormat'
import { useTranslation } from '../../i18n'
import { getStepModelName, getBadgeLang } from './agentLogMessageUtils'

interface AgentTimelineMessageProps {
  log: AgentActionLog
  isExpanded: boolean
  onToggleExpand: (id: string) => void
  activeModelName?: string
  onOpenFile?: (file: WorkspaceFile) => void
}

export const AgentTimelineMessage: React.FC<AgentTimelineMessageProps> = ({
  log,
  isExpanded,
  onToggleExpand,
  activeModelName,
  onOpenFile,
}) => {
  const { t } = useTranslation()

  const isUserMsg = log.message.startsWith('User Prompt: ')
  const isAgentQuestion =
    log.message.includes('❓ AI Agent Question:') ||
    log.message.startsWith('Agent Question:') ||
    log.message.startsWith('Agent requested clarification:')

  // Distinct User Prompt Bubble
  if (isUserMsg) {
    const text = log.message.replace('User Prompt: ', '')
    return (
      <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-950/60 via-blue-950/40 to-slate-900/90 border border-indigo-500/40 text-slate-100 font-sans text-xs space-y-2 shadow-lg">
        <div className="flex items-center justify-between border-b border-indigo-500/20 pb-2">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-indigo-300">
              <User className="w-3 h-3" />
            </div>
            <span className="font-bold text-xs text-indigo-300">{t('coding.userRole')}</span>
          </div>
          <span className="text-[10px] text-indigo-400/70 font-mono">{formatClockTime(log.timestamp)}</span>
        </div>
        <div className="whitespace-pre-wrap leading-relaxed text-slate-100 font-medium">{text}</div>
      </div>
    )
  }

  // Distinct Agent Question (Ask tool / Clarification request)
  if (isAgentQuestion) {
    const qText = log.message
      .replace('❓ AI Agent Question: ', '')
      .replace('Agent Question: ', '')
      .replace('Agent requested clarification: ', '')
    return (
      <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-950/50 to-slate-900/90 border-2 border-amber-500/70 text-amber-100 font-sans text-xs space-y-2 shadow-xl animate-in fade-in duration-200">
        <div className="flex items-center justify-between border-b border-amber-500/30 pb-2">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-400/50 flex items-center justify-center text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <span className="font-bold text-xs text-amber-300">{t('coding.agentQuestion')}</span>
          </div>
          <span className="text-[10px] text-amber-400/80 font-mono">{formatClockTime(log.timestamp)}</span>
        </div>
        <div className="whitespace-pre-wrap leading-relaxed font-semibold text-amber-200">{qText}</div>
      </div>
    )
  }

  // Command Execution step badge
  if (log.message.includes('run_command') || log.message.startsWith('Ran ') || log.message.includes('npm ') || log.message.includes('git ')) {
    const cmdMatch = log.message.match(/run_command.*?"command":\s*"([^"]+)"/) || log.message.match(/Ran\s+(.+)/)
    const cmdText = cmdMatch ? cmdMatch[1] : log.message
    return (
      <div className="space-y-1.5 font-mono">
        <button
          type="button"
          onClick={() => onToggleExpand(log.id)}
          className="w-full text-left flex items-center justify-between text-slate-300 hover:text-slate-100 py-1 px-1 rounded transition-colors group focus-ring"
        >
          <span className="flex items-center gap-2 text-xs">
            <span className="text-slate-400 font-sans font-medium">Ran</span>
            <span className="font-bold text-slate-200 group-hover:text-cyan-300 transition-colors">{cmdText}</span>
          </span>
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
        </button>

        {isExpanded && (
          <div className="p-3 rounded-xl bg-[#030712] border border-slate-800 text-[11px] text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed shadow-inner">
            <div className="text-slate-400 mb-1">../workspace &gt; {cmdText}</div>
            {log.detail || log.message}
          </div>
        )}
      </div>
    )
  }

  // File Edit step badge
  if (log.message.includes('replace_chunk') || log.message.includes('write_file') || log.message.startsWith('Edited ')) {
    const fileMatch = log.message.match(/filePath":\s*"([^"]+)"/) || log.message.match(/Edited\s+([^\s]+)/)
    const filePath = fileMatch ? fileMatch[1] : 'file'
    const fileName = filePath.split(/[\\/]/).pop() || filePath
    const badge = getBadgeLang(fileName)

    return (
      <div className="flex items-center justify-between text-xs py-1 px-1 rounded font-mono group">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 font-sans font-medium">Edited</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] ${badge.color}`}>
            {badge.label}
          </span>
          <button
            type="button"
            onClick={() => onOpenFile && onOpenFile({ name: fileName, path: filePath, isDir: false })}
            className="font-bold text-slate-200 hover:text-cyan-300 transition-colors cursor-pointer focus-ring rounded"
            title={t('common.viewDetails')}
          >
            {fileName}
          </button>
        </div>
        <button
          type="button"
          onClick={() => onOpenFile && onOpenFile({ name: fileName, path: filePath, isDir: false })}
          className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] font-mono text-cyan-400 hover:text-cyan-300 transition-colors focus-ring"
        >
          {t('common.viewDetails')}
        </button>
      </div>
    )
  }

  // Explored File step badge
  if (log.message.includes('read_file') || log.message.includes('list_dir') || log.message.includes('grep_search') || log.message.startsWith('Explored ')) {
    return (
      <button
        type="button"
        onClick={() => onToggleExpand(log.id)}
        className="w-full text-left flex items-center justify-between text-slate-300 hover:text-slate-100 py-1 px-1 rounded transition-colors group font-mono focus-ring"
      >
        <span className="flex items-center gap-1.5 text-xs text-slate-300 group-hover:text-slate-100">
          <span className="text-slate-400 font-sans font-medium">Explored</span>
          <span className="font-bold text-slate-200">workspace</span>
        </span>
        {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
      </button>
    )
  }

  // General assistant output card
  return (
    <div className="p-3.5 rounded-2xl bg-[#0e1422] border border-slate-800/90 text-slate-200 font-sans text-xs leading-relaxed space-y-2 shadow-md">
      <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400">
            <Bot className="w-3 h-3" />
          </div>
          <span className="font-bold text-xs text-emerald-400">{t('coding.agentRole')}</span>
          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-mono font-bold">
            {getStepModelName(log.message, activeModelName)}
          </span>
        </div>
        <span className="text-[10px] text-slate-400 font-mono">{formatClockTime(log.timestamp)}</span>
      </div>
      <div className="whitespace-pre-wrap leading-relaxed">{log.message}</div>
      {log.detail && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => onToggleExpand(log.id)}
            className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-mono font-semibold"
          >
            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {isExpanded ? t('common.close') : t('common.viewDetails')}
          </button>
          {isExpanded && (
            <pre className="mt-1.5 p-2.5 bg-slate-950 rounded-lg border border-slate-800 text-[10px] font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-60 leading-relaxed">
              {log.detail}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
