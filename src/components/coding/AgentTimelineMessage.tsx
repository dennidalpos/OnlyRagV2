import React from 'react'
import {
  ChevronDown,
  ChevronRight,
  User,
  Bot,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Terminal,
  Globe,
  FolderTree,
  Copy,
  Check,
} from 'lucide-react'
import { AgentActionLog, WorkspaceFile } from '../../types'
import { formatClockTime } from '../../lib/timeFormat'
import { useTranslation } from '../../i18n'
import {
  getStepModelName,
  getBadgeLang,
  categorizeAgentLog,
  type CategorizedAgentLog,
} from './agentLogMessageUtils'

function formatInlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="text-slate-100 font-semibold">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="px-1.5 py-0.5 rounded bg-slate-950 text-cyan-300 font-mono text-[11px] border border-slate-800"
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    return part
  })
}

function renderMarkdownReportContent(text: string): React.ReactNode {
  const lines = text.split('\n')
  return (
    <div className="space-y-1.5 text-xs leading-relaxed text-slate-200 font-sans">
      {lines.map((line, idx) => {
        const trimmed = line.trim()
        if (!trimmed) {
          return <div key={idx} className="h-1" />
        }
        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={idx} className="text-xs font-bold text-emerald-300 pt-2 pb-0.5 border-b border-emerald-900/40 flex items-center gap-1.5">
              <span>{formatInlineMarkdown(trimmed.slice(4))}</span>
            </h4>
          )
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h3 key={idx} className="text-sm font-bold text-emerald-200 pt-2.5 pb-1 border-b border-emerald-800/50">
              {formatInlineMarkdown(trimmed.slice(3))}
            </h3>
          )
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h2 key={idx} className="text-base font-extrabold text-emerald-100 pt-3 pb-1 border-b border-emerald-700/60">
              {formatInlineMarkdown(trimmed.slice(2))}
            </h2>
          )
        }
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <div key={idx} className="flex items-start gap-2 ml-2 my-0.5">
              <span className="text-emerald-400 mt-0.5 text-[10px] shrink-0">✦</span>
              <span className="text-slate-200">{formatInlineMarkdown(trimmed.slice(2))}</span>
            </div>
          )
        }
        if (/^\d+\.\s/.test(trimmed)) {
          const match = trimmed.match(/^(\d+\.)\s*(.+)/)
          return (
            <div key={idx} className="flex items-start gap-2 ml-2 my-0.5">
              <span className="text-emerald-400 font-mono font-bold text-[10px] shrink-0">{match?.[1]}</span>
              <span className="text-slate-200">{formatInlineMarkdown(match?.[2] || trimmed)}</span>
            </div>
          )
        }
        if (trimmed === '---' || trimmed === '***') {
          return <hr key={idx} className="my-2 border-emerald-800/40" />
        }
        return (
          <p key={idx} className="text-slate-300 my-0.5 leading-relaxed">
            {formatInlineMarkdown(trimmed)}
          </p>
        )
      })}
    </div>
  )
}

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
  const [isCopied, setIsCopied] = React.useState(false)
  const parsed: CategorizedAgentLog = React.useMemo(
    () => categorizeAgentLog(log.message, log.type),
    [log.message, log.type]
  )

  // 1. Distinct User Prompt Bubble
  if (parsed.category === 'user_prompt') {
    const text = parsed.userPromptText || log.message
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

  // 2. Distinct Agent Question (Ask tool / Clarification request)
  if (parsed.category === 'agent_question') {
    const qText = parsed.agentQuestionText || log.message
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

  // 3. Dedicated Final Implementation Report Card
  if (parsed.category === 'final_report') {
    const reportText = parsed.finalReportText || log.detail || log.message
    const handleCopy = () => {
      navigator.clipboard.writeText(reportText)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    }

    return (
      <div className="p-4 rounded-2xl bg-gradient-to-b from-emerald-950/40 via-slate-900/90 to-slate-950/95 border-2 border-emerald-500/60 text-slate-100 font-sans text-xs space-y-3 shadow-xl animate-in fade-in duration-200">
        <div className="flex items-center justify-between border-b border-emerald-500/30 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-400/60 flex items-center justify-center text-emerald-400 shadow-sm shadow-emerald-500/20">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
            <span className="font-bold text-xs text-emerald-300">
              Report Finale di Implementazione
            </span>
            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-mono font-bold">
              {getStepModelName(log.message, activeModelName)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-emerald-400/70 font-mono">{formatClockTime(log.timestamp)}</span>
            <button
              type="button"
              onClick={handleCopy}
              className="p-1 px-2 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-700/60 text-[10px] text-emerald-200 flex items-center gap-1 font-mono transition-all active:scale-95 focus-ring"
              title="Copia Report"
            >
              {isCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{isCopied ? 'Copiato' : 'Copia'}</span>
            </button>
          </div>
        </div>

        {renderMarkdownReportContent(reportText)}
      </div>
    )
  }

  // 3. Test Run Badge
  if (parsed.category === 'test_run' && parsed.testRun) {
    const { isPass, summary } = parsed.testRun
    return (
      <div className="space-y-1.5 font-mono">
        <button
          type="button"
          onClick={() => log.detail && onToggleExpand(log.id)}
          className={`w-full text-left flex items-center justify-between py-1.5 px-2 rounded-lg transition-colors group focus-ring border ${
            isPass
              ? 'bg-emerald-950/30 border-emerald-800/50 hover:bg-emerald-950/50'
              : 'bg-rose-950/30 border-rose-800/50 hover:bg-rose-950/50'
          }`}
        >
          <div className="flex items-center gap-2 text-xs">
            {isPass ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            )}
            <span className="font-sans font-medium text-slate-400">Tests</span>
            <span className={`font-bold ${isPass ? 'text-emerald-300' : 'text-rose-300'}`}>
              {summary}
            </span>
          </div>
          {log.detail && (
            isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          )}
        </button>

        {isExpanded && log.detail && (
          <div className="p-3 rounded-xl bg-[#030712] border border-slate-800 text-[11px] text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed shadow-inner max-h-64">
            {log.detail}
          </div>
        )}
      </div>
    )
  }

  // 4. File Mutation Badge (Created, Edited, Deleted, Moved, Copied)
  if (parsed.category === 'file_mutation' && parsed.fileMutation) {
    const { verb, fileName, filePath } = parsed.fileMutation
    const badge = getBadgeLang(fileName)

    const verbColor =
      verb === 'Created'
        ? 'text-emerald-400'
        : verb === 'Deleted'
        ? 'text-rose-400'
        : verb === 'Moved' || verb === 'Copied'
        ? 'text-amber-400'
        : 'text-cyan-400'

    return (
      <div className="space-y-1.5 font-mono">
        <div className="flex items-center justify-between text-xs py-1 px-1 rounded group">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`font-sans font-medium text-xs ${verbColor}`}>{verb}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${badge.color}`}>
              {badge.label}
            </span>
            <button
              type="button"
              onClick={() => onOpenFile && onOpenFile({ name: fileName, path: filePath, isDir: false })}
              className="font-bold text-slate-200 hover:text-cyan-300 transition-colors cursor-pointer focus-ring rounded truncate"
              title={filePath}
            >
              {fileName}
            </button>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {log.detail && (
              <button
                type="button"
                onClick={() => onToggleExpand(log.id)}
                className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-0.5 focus-ring px-1.5 py-0.5 rounded"
              >
                {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenFile && onOpenFile({ name: fileName, path: filePath, isDir: false })}
              className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] font-mono text-cyan-400 hover:text-cyan-300 transition-colors focus-ring"
            >
              {t('common.viewDetails')}
            </button>
          </div>
        </div>

        {isExpanded && log.detail && (
          <div className="p-3 rounded-xl bg-[#030712] border border-slate-800 text-[11px] text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed shadow-inner max-h-64">
            {log.detail}
          </div>
        )}
      </div>
    )
  }

  // 5. Command Execution Badge
  if (parsed.category === 'command_execution' && parsed.commandExecution) {
    const { command, isInstall } = parsed.commandExecution
    return (
      <div className="space-y-1.5 font-mono">
        <button
          type="button"
          onClick={() => onToggleExpand(log.id)}
          className="w-full text-left flex items-center justify-between text-slate-300 hover:text-slate-100 py-1 px-1 rounded transition-colors group focus-ring"
        >
          <div className="flex items-center gap-2 text-xs min-w-0">
            <Terminal className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="text-slate-400 font-sans font-medium">
              {isInstall ? 'Installed' : 'Ran'}
            </span>
            <span className="font-bold text-slate-200 group-hover:text-cyan-300 transition-colors truncate">
              {command}
            </span>
          </div>
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
        </button>

        {isExpanded && (
          <div className="p-3 rounded-xl bg-[#030712] border border-slate-800 text-[11px] text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed shadow-inner max-h-64">
            <div className="text-slate-500 mb-1">workspace &gt; {command}</div>
            {log.detail || log.message}
          </div>
        )}
      </div>
    )
  }

  // 6. Web Research Badge
  if (parsed.category === 'web_research' && parsed.webResearch) {
    const { action, queryOrUrl } = parsed.webResearch
    return (
      <div className="space-y-1.5 font-mono">
        <button
          type="button"
          onClick={() => log.detail && onToggleExpand(log.id)}
          className="w-full text-left flex items-center justify-between text-slate-300 hover:text-slate-100 py-1 px-1 rounded transition-colors group focus-ring"
        >
          <div className="flex items-center gap-2 text-xs min-w-0">
            <Globe className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="text-slate-400 font-sans font-medium">{action}</span>
            <span className="font-bold text-slate-200 group-hover:text-indigo-300 transition-colors truncate">
              {queryOrUrl}
            </span>
          </div>
          {log.detail && (
            isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          )}
        </button>

        {isExpanded && log.detail && (
          <div className="p-3 rounded-xl bg-[#030712] border border-slate-800 text-[11px] text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed shadow-inner max-h-64">
            {log.detail}
          </div>
        )}
      </div>
    )
  }

  // 7. Workspace Exploration Badge
  if (parsed.category === 'workspace_exploration' && parsed.workspaceExploration) {
    const { action, target } = parsed.workspaceExploration
    return (
      <div className="space-y-1.5 font-mono">
        <button
          type="button"
          onClick={() => onToggleExpand(log.id)}
          className="w-full text-left flex items-center justify-between text-slate-300 hover:text-slate-100 py-1 px-1 rounded transition-colors group focus-ring"
        >
          <div className="flex items-center gap-2 text-xs min-w-0">
            <FolderTree className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-slate-400 font-sans font-medium">{action}</span>
            <span className="font-bold text-slate-200 group-hover:text-amber-300 transition-colors truncate">
              {target}
            </span>
          </div>
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
        </button>

        {isExpanded && (
          <div className="p-3 rounded-xl bg-[#030712] border border-slate-800 text-[11px] text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed shadow-inner max-h-64">
            {log.detail || log.message}
          </div>
        )}
      </div>
    )
  }

  // 8. General assistant output card / Plan update
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
            className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-mono font-semibold focus-ring"
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
