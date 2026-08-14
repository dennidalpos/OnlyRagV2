import React, { useEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  Square,
  Paperclip,
  Terminal,
  FileCode,
  FileText,
  ChevronDown,
  ChevronRight,
  Loader2,
  Sparkles,
  User,
  Bot,
  Plus,
  Sliders,
  Check,
  Code2,
  Clock,
  Trash2,
  Edit2,
  ListPlus,
  X,
  RotateCcw,
} from 'lucide-react'
import { AgentActionLog, IngestedDocument, WorkspaceFile } from '../../types'
import { AgentMode } from './CodingAgentView'
import { QueuedPrompt } from '../../hooks/useCodingAgent'
import { evaluateTaskComplexity } from '../../services/complexityRouterService'

interface AgentActionLogPanelProps {
  actionLogs: AgentActionLog[]
  agentMode: AgentMode
  setAgentMode: (mode: AgentMode) => void
  agentPrompt: string
  setAgentPrompt: (prompt: string) => void
  isExecuting: boolean
  activeSkills?: string[]
  onExecute: () => void
  onCancel: () => void
  pinnedFiles: Map<string, WorkspaceFile>
  ingestedDocs: IngestedDocument[]
  attachedDocIds: Set<string>
  onToggleAttachDoc: (docId: string) => void
  selectedFile: WorkspaceFile | null
  activeModelName?: string
  onOpenFile?: (file: WorkspaceFile) => void
  promptQueue?: QueuedPrompt[]
  onRemoveFromQueue?: (id: string) => void
  onEditPromptInQueue?: (id: string, newPrompt: string) => void
  onOpenPromptModal?: () => void
  onOpenSkillHubModal?: () => void
  onResetSession?: () => void
}

export const AgentActionLogPanel: React.FC<AgentActionLogPanelProps> = ({
  actionLogs,
  agentMode,
  setAgentMode,
  agentPrompt,
  setAgentPrompt,
  isExecuting,
  activeSkills = [],
  onExecute,
  onCancel,
  pinnedFiles,
  ingestedDocs,
  attachedDocIds,
  onToggleAttachDoc,
  selectedFile,
  activeModelName,
  onOpenFile,
  promptQueue = [],
  onRemoveFromQueue,
  onEditPromptInQueue,
  onOpenPromptModal,
  onOpenSkillHubModal,
  onResetSession,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null)
  const toolsMenuRef = useRef<HTMLDivElement>(null)
  const [showToolsMenu, setShowToolsMenu] = useState(false)
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set())
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null)
  const [editingQueueText, setEditingQueueText] = useState<string>('')

  // Close tools popover on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setShowToolsMenu(false)
      }
    }
    if (showToolsMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showToolsMenu])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [actionLogs.length, isExecuting])

  const toggleExpand = (id: string) => {
    setExpandedLogIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (agentPrompt.trim()) {
        onExecute()
      }
    }
  }

  const getBadgeLang = (filename?: string) => {
    if (!filename) return { label: 'FILE', color: 'bg-slate-800 text-slate-300' }
    if (filename.endsWith('.tsx') || filename.endsWith('.ts')) return { label: 'TS', color: 'bg-sky-950 text-sky-400 border border-sky-800/80 font-bold' }
    if (filename.endsWith('.py')) return { label: 'PY', color: 'bg-amber-950 text-amber-400 border border-amber-800/80 font-bold' }
    if (filename.endsWith('.json')) return { label: 'JSON', color: 'bg-emerald-950 text-emerald-400 border border-emerald-800/80 font-bold' }
    if (filename.endsWith('.css')) return { label: 'CSS', color: 'bg-indigo-950 text-indigo-400 border border-indigo-800/80 font-bold' }
    if (filename.endsWith('.md')) return { label: 'MD', color: 'bg-cyan-950 text-cyan-400 border border-cyan-800/80 font-bold' }
    return { label: 'TXT', color: 'bg-slate-800 text-slate-300' }
  }

  return (
    <div className="h-full flex flex-col bg-[#0b0f17] text-slate-200 overflow-hidden select-text">
      {/* Timeline Stream */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs font-mono">
        {actionLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3 text-slate-500 font-sans select-none">
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 mb-1 shadow-lg shadow-cyan-950/20">
              <Code2 className="w-6 h-6" />
            </div>
            <div>
              <div className="font-semibold text-slate-200 text-sm">Autonomous Coding Agent</div>
              <p className="text-xs max-w-xs leading-relaxed text-slate-400 mt-1">
                Descrivi modifiche di codice, refactoring, test o esecuzione di comandi PowerShell nel tuo workspace locale.
              </p>
            </div>

            <div className="w-full pt-3 space-y-1.5 text-left font-sans">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider text-center">
                Azioni Rapide
              </div>
              <div className="flex flex-col gap-1.5">
                {[
                  'Esegui i test unitari con npm run test:fast',
                  'Esegui verifica tipi TypeScript con tsc --noEmit',
                  'Esegui audit di conformità del codice e pulizia',
                ].map((quickTask, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setAgentPrompt(quickTask)}
                    className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/40 text-[11px] text-slate-300 hover:text-cyan-200 transition-all text-left focus-ring active:scale-98"
                  >
                    {quickTask}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          actionLogs.map((log) => {
            const isUserMsg = log.message.startsWith('User Prompt: ')
            const isExpanded = expandedLogIds.has(log.id)

            if (isUserMsg) {
              const text = log.message.replace('User Prompt: ', '')
              return (
                <div key={log.id} className="p-3.5 rounded-2xl bg-[#161c28] border border-slate-800/80 text-slate-100 font-sans text-xs whitespace-pre-wrap shadow-lg">
                  {text}
                </div>
              )
            }

            // Command Execution step badge
            if (log.message.includes('run_command') || log.message.startsWith('Ran ') || log.message.includes('npm ') || log.message.includes('git ')) {
              const cmdMatch = log.message.match(/run_command.*?"command":\s*"([^"]+)"/) || log.message.match(/Ran\s+(.+)/)
              const cmdText = cmdMatch ? cmdMatch[1] : log.message
              return (
                <div key={log.id} className="space-y-1.5 font-mono">
                  <button
                    onClick={() => toggleExpand(log.id)}
                    className="w-full text-left flex items-center justify-between text-slate-400 hover:text-slate-200 py-1 px-1 rounded transition-colors group"
                  >
                    <span className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500 font-sans">Ran</span>
                      <span className="font-bold text-slate-300 group-hover:text-cyan-300 transition-colors">{cmdText}</span>
                    </span>
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
                  </button>

                  {isExpanded && (
                    <div className="p-3 rounded-xl bg-[#030712] border border-slate-800 text-[11px] text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed shadow-inner">
                      <div className="text-slate-500 mb-1">../OnlyRagV2 &gt; {cmdText}</div>
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
                <div key={log.id} className="flex items-center justify-between text-xs py-1 px-1 rounded font-mono group">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 font-sans">Edited</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${badge.color}`}>
                      {badge.label}
                    </span>
                    <button
                      onClick={() => onOpenFile && onOpenFile({ name: fileName, path: filePath, isDir: false })}
                      className="font-bold text-slate-200 hover:text-cyan-400 transition-colors cursor-pointer"
                      title="Apri file nell'editor"
                    >
                      {fileName}
                    </button>
                  </div>
                  <button
                    onClick={() => onOpenFile && onOpenFile({ name: fileName, path: filePath, isDir: false })}
                    className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] font-mono text-cyan-400 transition-colors"
                  >
                    Apri
                  </button>
                </div>
              )
            }

            // Explored File step badge
            if (log.message.includes('read_file') || log.message.includes('list_dir') || log.message.includes('grep_search') || log.message.startsWith('Explored ')) {
              return (
                <button
                  key={log.id}
                  onClick={() => toggleExpand(log.id)}
                  className="w-full text-left flex items-center justify-between text-slate-400 hover:text-slate-200 py-1 px-1 rounded transition-colors group font-mono"
                >
                  <span className="flex items-center gap-1.5 text-xs text-slate-400 group-hover:text-slate-300">
                    <span>Explored</span>
                    <span className="font-bold text-slate-300">1 file</span>
                  </span>
                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
                </button>
              )
            }

            // General assistant output card
            return (
              <div
                key={log.id}
                className="p-3 rounded-xl bg-[#111827]/70 border border-slate-800/80 text-slate-200 font-sans text-xs leading-relaxed"
              >
                <div className="whitespace-pre-wrap">{log.message}</div>
                {log.detail && (
                  <div className="mt-2">
                    <button
                      onClick={() => toggleExpand(log.id)}
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-mono font-semibold"
                    >
                      {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      {isExpanded ? 'Nascondi Dettagli' : 'Mostra Output'}
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
          })
        )}

        {isExecuting && (
          <div className="p-3 rounded-2xl bg-[#111827] border border-slate-800 space-y-2 text-xs text-cyan-300 font-sans shadow-lg animate-in fade-in duration-150">
            <div className="flex items-center gap-2.5">
              <Loader2 className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
              <span className="font-semibold text-slate-200">AI Coding Agent in esecuzione...</span>
            </div>
            {activeSkills.length > 0 && (
              <div className="flex items-center gap-1.5 pt-1.5 border-t border-slate-800/80 text-[11px] text-slate-300">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="text-slate-400">Skill attive:</span>
                <div className="flex flex-wrap gap-1">
                  {activeSkills.map((sk) => (
                    <span
                      key={sk}
                      className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono text-[10px] font-bold border border-cyan-500/30"
                    >
                      {sk}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Prompt Queue Card */}
      {promptQueue.length > 0 && (
        <div className="mx-3 mb-1 p-2.5 bg-[#121826] border border-slate-800 rounded-xl space-y-2 text-xs shrink-0">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
            <span className="flex items-center gap-1.5 text-cyan-400">
              <Clock className="w-3.5 h-3.5" /> Coda Prompt in Attesa ({promptQueue.length})
            </span>
            <span className="text-[10px] text-slate-500 font-mono">Esecuzione sequenziale automatica</span>
          </div>

          <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
            {promptQueue.map((item, idx) => {
              const isEditing = editingQueueId === item.id
              return (
                <div
                  key={item.id}
                  className="p-2 bg-[#090d16] border border-slate-800/80 rounded-lg flex items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono text-cyan-400 font-bold shrink-0">
                      #{idx + 1}
                    </span>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editingQueueText}
                        onChange={(e) => setEditingQueueText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            onEditPromptInQueue?.(item.id, editingQueueText)
                            setEditingQueueId(null)
                          } else if (e.key === 'Escape') {
                            setEditingQueueId(null)
                          }
                        }}
                        className="flex-1 bg-slate-950 border border-cyan-500/50 rounded px-2 py-0.5 text-slate-100 text-xs outline-none font-sans"
                        autoFocus
                      />
                    ) : (
                      <span className="truncate text-slate-300 text-[11px] font-sans" title={item.prompt}>
                        {item.prompt}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {isEditing ? (
                      <button
                        onClick={() => {
                          onEditPromptInQueue?.(item.id, editingQueueText)
                          setEditingQueueId(null)
                        }}
                        className="p-1 hover:bg-slate-800 text-emerald-400 rounded"
                        title="Salva modifica"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingQueueId(item.id)
                          setEditingQueueText(item.prompt)
                        }}
                        className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded"
                        title="Modifica prompt in coda"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                    )}

                    <button
                      onClick={() => onRemoveFromQueue?.(item.id)}
                      className="p-1 hover:bg-rose-950/80 text-slate-400 hover:text-rose-400 rounded transition-colors"
                      title="Rimuovi dalla coda"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Antigravity-Style Floating Prompt Composer Card */}
      <div className="p-3 bg-[#0b0f17] shrink-0">
        <div className="bg-[#161c28] border border-slate-800/80 focus-within:border-cyan-500/80 focus-within:ring-1 focus-within:ring-cyan-500/30 rounded-2xl p-2.5 transition-all shadow-xl space-y-2 relative">
          {/* Top/Center: Prompt Textarea */}
          <textarea
            value={agentPrompt}
            onChange={(e) => setAgentPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            aria-label="Prompt di istruzioni per l'AI Coding Agent"
            placeholder={
              isExecuting
                ? 'Task in esecuzione... Scrivi qui per accodare il prossimo prompt (Enter per accodare)'
                : 'Descrivi il task o chiedi modifiche al codice... (Enter per inviare, Shift+Enter per riga)'
            }
            className="w-full bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-500 resize-none font-sans leading-relaxed px-1"
          />

          {/* Bottom row: [Left: Context Menu Popover] --- [Right: Quick actions & Send] */}
          <div className="flex items-center justify-between pt-1 border-t border-slate-800/40">
            {/* Left: Menu contestuale a comparsa per strumenti e contesto */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowToolsMenu(!showToolsMenu)}
                aria-label="Menu strumenti e contesto"
                aria-haspopup="dialog"
                aria-expanded={showToolsMenu}
                title="Strumenti & Contesto"
                className={`px-2 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 ${
                  showToolsMenu || attachedDocIds.size > 0
                    ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/80 shadow-sm'
                    : 'bg-slate-900/90 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Plus className={`w-3.5 h-3.5 ${showToolsMenu ? 'rotate-45' : ''} transition-transform text-cyan-400`} />
                <span className="text-[11px]">Strumenti</span>
                {attachedDocIds.size > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-cyan-500 text-slate-950 font-bold text-[9px]">
                    {attachedDocIds.size}
                  </span>
                )}
              </button>

              {/* Contextual Popover Panel */}
              {showToolsMenu && (
                <div
                  ref={toolsMenuRef}
                  className="absolute bottom-full mb-2 left-0 w-72 bg-slate-900 border border-slate-800 rounded-2xl p-3 shadow-2xl space-y-3 z-30 font-sans"
                >
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                    <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-cyan-400" /> Menu Strumenti
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowToolsMenu(false)}
                      className="p-1 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Section 1: RAG Documents Attachment */}
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                      <span>Allegati RAG ({attachedDocIds.size})</span>
                      {attachedDocIds.size > 0 && (
                        <button
                          type="button"
                          onClick={() => attachedDocIds.forEach((id) => onToggleAttachDoc(id))}
                          className="text-[9px] text-cyan-400 hover:underline"
                        >
                          Deseleziona
                        </button>
                      )}
                    </div>
                    <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                      {ingestedDocs.length === 0 ? (
                        <div className="text-[11px] text-slate-500 italic p-1">Nessun documento indicizzato.</div>
                      ) : (
                        ingestedDocs.map((doc) => {
                          const isAttached = attachedDocIds.has(doc.id)
                          return (
                            <button
                              key={doc.id}
                              type="button"
                              onClick={() => onToggleAttachDoc(doc.id)}
                              className={`w-full text-left p-1.5 rounded-lg text-xs flex items-center justify-between transition-colors ${
                                isAttached ? 'bg-cyan-950 text-cyan-200 border border-cyan-800/60' : 'hover:bg-slate-800 text-slate-400'
                              }`}
                            >
                              <div className="flex items-center gap-1.5 truncate">
                                <FileText className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                                <span className="truncate text-[11px]">{doc.filename}</span>
                              </div>
                              <span className="text-[9px] font-mono shrink-0">{isAttached ? '✓' : '+'}</span>
                            </button>
                          )
                        })
                      )}
                    </div>
                  </div>

                  {/* Section 2: Moduli & System Prompt */}
                  <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Moduli &amp; Configurazione</div>
                    {onOpenSkillHubModal && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowToolsMenu(false)
                          onOpenSkillHubModal()
                        }}
                        className="w-full p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800/80 rounded-xl text-left flex items-center justify-between text-xs text-slate-300 hover:text-cyan-300 transition-colors"
                      >
                        <span className="flex items-center gap-2">
                          <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> Skill Hub &amp; Marketplace
                        </span>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                      </button>
                    )}
                    {onOpenPromptModal && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowToolsMenu(false)
                          onOpenPromptModal()
                        }}
                        className="w-full p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800/80 rounded-xl text-left flex items-center justify-between text-xs text-slate-300 hover:text-cyan-300 transition-colors"
                      >
                        <span className="flex items-center gap-2">
                          <Sliders className="w-3.5 h-3.5 text-cyan-400" /> Configura System Prompt
                        </span>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Right: Quick actions, states, mode switches, reset, send */}
            <div className="flex items-center gap-2">
              {/* Reset Session Mini Icon */}
              {onResetSession && (
                <button
                  type="button"
                  onClick={onResetSession}
                  aria-label="Nuova Sessione Agent"
                  title="Nuova Sessione & Svuota Contesto"
                  className="p-1.5 text-slate-400 hover:text-cyan-300 hover:bg-slate-800/80 rounded-lg transition-colors focus-ring"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Mode Selector Pill */}
              <div className="flex items-center bg-slate-900/90 rounded-xl border border-slate-800 p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => setAgentMode('plan')}
                  className={`px-2 py-0.5 rounded-lg font-semibold transition-all ${
                    agentMode === 'plan' ? 'bg-cyan-950 text-cyan-300 font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Plan
                </button>
                <button
                  type="button"
                  onClick={() => setAgentMode('ask')}
                  className={`px-2 py-0.5 rounded-lg font-semibold transition-all ${
                    agentMode === 'ask' ? 'bg-amber-950 text-amber-300 font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Ask
                </button>
                <button
                  type="button"
                  onClick={() => setAgentMode('agent')}
                  className={`px-2 py-0.5 rounded-lg font-semibold transition-all ${
                    agentMode === 'agent' ? 'bg-emerald-950 text-emerald-300 font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Agent
                </button>
              </div>

              {/* Complexity Router / Model Pill */}
              {agentPrompt.trim() ? (
                (() => {
                  const liveComplexity = evaluateTaskComplexity(agentPrompt, pinnedFiles.size, selectedFile?.sizeBytes || 0)
                  return (
                    <div
                      className={`hidden sm:flex items-center gap-1 px-2 py-0.5 rounded-xl text-[10px] font-mono border transition-all ${liveComplexity.badgeColorClass}`}
                      title={`Complexity Router: ${liveComplexity.tierName} (${liveComplexity.modelName}) — ${liveComplexity.reasoning}`}
                    >
                      <span className="truncate max-w-[120px]">{liveComplexity.badgeLabel}</span>
                    </div>
                  )
                })()
              ) : (
                <div className="hidden sm:flex items-center gap-1 px-2 py-0.5 bg-slate-900/80 border border-slate-800 rounded-xl text-[10px] font-mono text-slate-300">
                  <Sparkles className="w-3 h-3 text-cyan-400" />
                  <span className="truncate max-w-[90px]">{activeModelName || 'qwen2.5-coder:7b'}</span>
                </div>
              )}

              {/* Action Buttons: Accoda / Send / Stop */}
              {isExecuting && (
                <button
                  type="button"
                  onClick={onCancel}
                  aria-label="Interrompi esecuzione task attivo"
                  title="Interrompi task attivo"
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
                  aria-label="Accoda prompt per esecuzione successiva"
                  title="Accoda prompt"
                  className="px-2.5 py-1 bg-gradient-to-r from-cyan-600 to-sky-500 hover:from-cyan-500 hover:to-sky-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold text-xs rounded-xl flex items-center gap-1 transition-all shadow-md active:scale-95"
                >
                  <ListPlus className="w-3.5 h-3.5" />
                  <span className="text-[11px]">Accoda</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onExecute()}
                  disabled={!agentPrompt.trim()}
                  aria-label="Invia prompt all'AI Coding Agent"
                  className="w-7 h-7 rounded-full bg-gradient-to-tr from-cyan-600 to-sky-500 hover:from-cyan-500 hover:to-sky-400 disabled:opacity-30 disabled:cursor-not-allowed text-slate-950 flex items-center justify-center transition-all shadow-md shadow-cyan-950/50 active:scale-95"
                >
                  <ArrowUp className="w-3.5 h-3.5 font-bold" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
