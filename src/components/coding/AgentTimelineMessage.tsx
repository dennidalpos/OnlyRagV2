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
  extractBaseName,
  resolveLogCategory,
} from './agentLogMessageUtils'

function formatInlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={i} className="text-slate-100 font-bold">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2 && !part.startsWith('**')) {
      return (
        <em key={i} className="text-slate-200 italic">
          {part.slice(1, -1)}
        </em>
      )
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
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

function renderMarkdownContent(text: string): React.ReactNode {
  if (!text) return null
  const lines = text.split(/\r?\n/)
  const elements: React.ReactNode[] = []

  let inCodeBlock = false
  let codeBlockLang = ''
  let codeBlockLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    const trimmed = rawLine.trim()

    // Fenced code block detection
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        const codeText = codeBlockLines.join('\n')
        elements.push(
          <div key={`code-${i}`} className="my-2 rounded-xl bg-[#030712] border border-slate-800 overflow-hidden shadow-inner font-mono text-xs">
            {codeBlockLang && (
              <div className="px-3 py-1 bg-slate-900 border-b border-slate-800 text-[10px] font-bold text-cyan-400 uppercase tracking-wider">
                {codeBlockLang}
              </div>
            )}
            <pre className="p-3 overflow-x-auto text-slate-200 text-[11px] leading-relaxed whitespace-pre">
              <code>{codeText}</code>
            </pre>
          </div>
        )
        inCodeBlock = false
        codeBlockLines = []
        codeBlockLang = ''
      } else {
        inCodeBlock = true
        codeBlockLang = trimmed.slice(3).trim()
        codeBlockLines = []
      }
      continue
    }

    if (inCodeBlock) {
      codeBlockLines.push(rawLine)
      continue
    }

    if (!trimmed) {
      elements.push(<div key={`spacer-${i}`} className="h-1" />)
      continue
    }

    if (trimmed.startsWith('### ')) {
      elements.push(
        <h4 key={`h4-${i}`} className="text-xs font-bold text-cyan-300 pt-2 pb-0.5 border-b border-slate-800 flex items-center gap-1.5">
          <span>{formatInlineMarkdown(trimmed.slice(4))}</span>
        </h4>
      )
    } else if (trimmed.startsWith('## ')) {
      elements.push(
        <h3 key={`h3-${i}`} className="text-sm font-bold text-slate-100 pt-2 pb-0.5 border-b border-slate-800">
          {formatInlineMarkdown(trimmed.slice(3))}
        </h3>
      )
    } else if (trimmed.startsWith('# ')) {
      elements.push(
        <h2 key={`h2-${i}`} className="text-base font-extrabold text-slate-100 pt-2.5 pb-1 border-b border-slate-700">
          {formatInlineMarkdown(trimmed.slice(2))}
        </h2>
      )
    } else if (trimmed.startsWith('> ')) {
      elements.push(
        <blockquote key={`quote-${i}`} className="pl-3 py-0.5 border-l-2 border-cyan-500/50 text-slate-300 bg-cyan-950/10 rounded-r-lg my-1 text-xs italic">
          {formatInlineMarkdown(trimmed.slice(2))}
        </blockquote>
      )
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      elements.push(
        <div key={`li-${i}`} className="flex items-start gap-2 ml-2 my-0.5">
          <span className="text-cyan-400 mt-0.5 text-[10px] shrink-0">✦</span>
          <span className="text-slate-200">{formatInlineMarkdown(trimmed.slice(2))}</span>
        </div>
      )
    } else if (/^\d+\.\s/.test(trimmed)) {
      const match = trimmed.match(/^(\d+\.)\s*(.+)/)
      elements.push(
        <div key={`oli-${i}`} className="flex items-start gap-2 ml-2 my-0.5">
          <span className="text-cyan-400 font-mono font-bold text-[10px] shrink-0">{match?.[1]}</span>
          <span className="text-slate-200">{formatInlineMarkdown(match?.[2] || trimmed)}</span>
        </div>
      )
    } else if (trimmed === '---' || trimmed === '***') {
      elements.push(<hr key={`hr-${i}`} className="my-2 border-slate-800" />)
    } else {
      elements.push(
        <p key={`p-${i}`} className="text-slate-300 my-0.5 leading-relaxed">
          {formatInlineMarkdown(trimmed)}
        </p>
      )
    }
  }

  if (inCodeBlock && codeBlockLines.length > 0) {
    elements.push(
      <div key="unclosed-code" className="my-2 rounded-xl bg-[#030712] border border-slate-800 p-3 overflow-x-auto font-mono text-[11px] text-slate-200">
        <pre><code>{codeBlockLines.join('\n')}</code></pre>
      </div>
    )
  }

  return <div className="space-y-1 text-xs leading-relaxed text-slate-200 font-sans">{elements}</div>
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
  const resolved = React.useMemo(() => resolveLogCategory(log), [log])

  // 1. User Prompt Bubble
  if (resolved.category === 'user_prompt') {
    const text = log.message.replace(/^User Prompt:\s*/i, '')
    return (
      <div className="p-3.5 rounded-2xl bg-gradient-to-r from-indigo-950/70 via-blue-950/40 to-slate-900/90 border border-indigo-500/40 text-slate-100 font-sans text-xs space-y-1.5 shadow-lg">
        <div className="flex items-center justify-between border-b border-indigo-500/20 pb-1.5">
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

  // 2. Agent Question / Clarification Request
  if (resolved.category === 'agent_question') {
    const qText = log.message.replace(/^❓\s*AI Agent Question:\s*/i, '').replace(/^Agent Question:\s*/i, '')
    return (
      <div className="p-3.5 rounded-2xl bg-gradient-to-r from-amber-950/50 to-slate-900/90 border-2 border-amber-500/70 text-amber-100 font-sans text-xs space-y-2 shadow-xl animate-in fade-in duration-200">
        <div className="flex items-center justify-between border-b border-amber-500/30 pb-1.5">
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

  // 3. Final Implementation Report Card
  if (resolved.category === 'final_report') {
    const reportText = log.detail || log.message.replace(/^Task Finished:\s*/i, '').replace(/^Task completed:\s*/i, '')
    const handleCopy = () => {
      navigator.clipboard.writeText(reportText)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    }

    return (
      <div className="p-4 rounded-2xl bg-gradient-to-b from-emerald-950/40 via-slate-900/90 to-slate-950/95 border-2 border-emerald-500/60 text-slate-100 font-sans text-xs space-y-3 shadow-xl animate-in fade-in duration-200">
        <div className="flex items-center justify-between border-b border-emerald-500/30 pb-2">
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
              className="p-1 px-2 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-700/60 text-[10px] text-emerald-200 flex items-center gap-1 font-mono transition-all active:scale-95 cursor-pointer"
              title="Copia Report"
            >
              {isCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{isCopied ? 'Copiato' : 'Copia'}</span>
            </button>
          </div>
        </div>

        {renderMarkdownContent(reportText)}
      </div>
    )
  }

  // 3.5. System Diagnostic Alert / Blocker / Loop Intervention Card
  if (resolved.category === 'system_alert') {
    const isLoopWarning = log.message.includes('Loop') || log.message.includes('Oscillation') || log.message.includes('Intervention')
    return (
      <div
        className={`p-3.5 rounded-2xl border text-xs space-y-2 shadow-lg animate-in fade-in duration-200 ${
          isLoopWarning
            ? 'bg-amber-950/40 border-amber-500/60 text-amber-200'
            : 'bg-rose-950/40 border-rose-500/60 text-rose-200'
        }`}
      >
        <div className="flex items-center justify-between border-b pb-1.5 border-slate-800/80">
          <div className="flex items-center gap-2">
            <AlertTriangle className={`w-3.5 h-3.5 ${isLoopWarning ? 'text-amber-400' : 'text-rose-400'}`} />
            <span className="font-bold text-xs uppercase tracking-wide">
              {isLoopWarning ? 'Loop Intervention Warning' : 'System Diagnostic Alert'}
            </span>
          </div>
          <span className="text-[10px] opacity-70 font-mono">{formatClockTime(log.timestamp)}</span>
        </div>
        <div className="whitespace-pre-wrap leading-relaxed">{renderMarkdownContent(log.message)}</div>
        {log.detail && (
          <div className="mt-1.5 p-2 rounded-xl bg-black/50 border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-48 whitespace-pre-wrap">
            {log.detail}
          </div>
        )}
      </div>
    )
  }

  // 4. Test Run Badge
  if (resolved.category === 'test_run') {
    const isPass = log.testRun ? log.testRun.isPass : !log.message.includes('FAIL') && (log.message.includes('PASS') || log.status === 'success')
    const summary = log.testRun?.summary || log.message
    return (
      <div className="space-y-1.5 font-mono">
        <button
          type="button"
          onClick={() => log.detail && onToggleExpand(log.id)}
          className={`w-full text-left flex items-center justify-between py-1.5 px-2.5 rounded-xl transition-colors group border cursor-pointer ${
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

  // 5. File Mutation Badge (Created, Edited, Deleted, Moved, Copied)
  if (resolved.category === 'file_mutation') {
    const verb = log.verb || resolved.verb || (log.message.includes('Created') || log.message.includes('write_file') ? 'Created' : 'Edited')
    const targetPath = log.target || resolved.target
    const fileName = extractBaseName(targetPath) || targetPath
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
        <div className="flex items-center justify-between text-xs py-1 px-2 rounded-xl bg-slate-900/60 border border-slate-800/80 group">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`font-sans font-medium text-xs ${verbColor}`}>{verb}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${badge.color}`}>
              {badge.label}
            </span>
            <button
              type="button"
              onClick={() => onOpenFile && onOpenFile({ name: fileName, path: targetPath, isDir: false })}
              className="font-bold text-slate-200 hover:text-cyan-300 transition-colors cursor-pointer rounded truncate"
              title={targetPath}
            >
              {fileName}
            </button>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {log.detail && (
              <button
                type="button"
                onClick={() => onToggleExpand(log.id)}
                className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-0.5 px-1.5 py-0.5 rounded cursor-pointer"
              >
                {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenFile && onOpenFile({ name: fileName, path: targetPath, isDir: false })}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-mono text-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer"
            >
              Diff / View
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

  // 6. Command Execution Badge
  if (resolved.category === 'command_execution') {
    const cmdText = log.target || log.message.replace(/^Ran\s+/, '').replace(/^Executed command:\s*/, '')
    return (
      <div className="space-y-1.5 font-mono">
        <button
          type="button"
          onClick={() => log.detail && onToggleExpand(log.id)}
          className="w-full text-left flex items-center justify-between text-slate-300 hover:text-slate-100 py-1.5 px-2.5 rounded-xl bg-slate-900/60 border border-slate-800/80 transition-colors group cursor-pointer"
        >
          <div className="flex items-center gap-2 text-xs min-w-0">
            <Terminal className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="text-slate-400 font-sans font-medium">Ran</span>
            <span className="font-bold text-slate-200 group-hover:text-cyan-300 transition-colors truncate">
              {cmdText}
            </span>
          </div>
          {log.detail && (
            isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          )}
        </button>

        {isExpanded && (
          <div className="p-3 rounded-xl bg-[#030712] border border-slate-800 text-[11px] text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed shadow-inner max-h-64">
            <div className="text-slate-500 mb-1">workspace &gt; {cmdText}</div>
            {log.detail || log.message}
          </div>
        )}
      </div>
    )
  }

  // 7. Web Research Badge
  if (resolved.category === 'web_research') {
    const action = log.verb || 'Search'
    const queryOrUrl = log.target || log.message
    return (
      <div className="space-y-1.5 font-mono">
        <button
          type="button"
          onClick={() => log.detail && onToggleExpand(log.id)}
          className="w-full text-left flex items-center justify-between text-slate-300 hover:text-slate-100 py-1.5 px-2.5 rounded-xl bg-slate-900/60 border border-slate-800/80 transition-colors group cursor-pointer"
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

  // 8. Workspace Exploration Badge
  if (resolved.category === 'workspace_exploration') {
    const action = log.verb || 'Explored'
    const target = log.target || extractBaseName(log.message) || 'workspace'
    return (
      <div className="space-y-1.5 font-mono">
        <button
          type="button"
          onClick={() => onToggleExpand(log.id)}
          className="w-full text-left flex items-center justify-between text-slate-300 hover:text-slate-100 py-1.5 px-2.5 rounded-xl bg-slate-900/60 border border-slate-800/80 transition-colors group cursor-pointer"
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

  // 9. Agent Thought / Assistant Response Bubble
  return (
    <div className="p-3.5 rounded-2xl bg-[#0e1422] border border-slate-800/90 text-slate-200 font-sans text-xs leading-relaxed space-y-2 shadow-md">
      <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400">
            <Bot className="w-3 h-3" />
          </div>
          <span className="font-bold text-xs text-emerald-400">{t('coding.agentRole')}</span>
          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-mono font-bold">
            {log.modelName || getStepModelName(log.message, activeModelName)}
          </span>
        </div>
        <span className="text-[10px] text-slate-400 font-mono">{formatClockTime(log.timestamp)}</span>
      </div>
      <div className="whitespace-pre-wrap leading-relaxed">{renderMarkdownContent(log.message)}</div>
      {log.detail && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => onToggleExpand(log.id)}
            className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-mono font-semibold cursor-pointer"
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
