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
  ArrowDown,
  AlertTriangle,
  FolderOpen,
  MessageSquare,
  ClipboardList,
} from 'lucide-react'
import { AgentActionLog, IngestedDocument, WorkspaceFile, AppSettings, CodingSession } from '../../types'
import { AgentMode } from './CodingAgentView'
import { QueuedPrompt } from '../../hooks/useCodingAgent'
import { evaluateTaskComplexity } from '../../services/complexityRouterService'
import { useTranslation } from '../../i18n'

export function getStepModelName(message: string, fallbackModelName?: string): string {
  if (!message) return fallbackModelName || 'LLM'

  const consultingMatch = message.match(/Consulting LLM \(([^)]+)\)/i)
  if (consultingMatch && consultingMatch[1]) {
    return consultingMatch[1].trim()
  }

  const complexityMatch = message.match(/(?:Complexity Escalated|Escalation a Deep Reasoning|Escalated to|Escalating to):\s*([a-zA-Z0-9._:\-]+)/i)
  if (complexityMatch && complexityMatch[1]) {
    return complexityMatch[1].trim()
  }

  const bracketMatch =
    message.match(/fallback to \[([^\]]+)\]/i) ||
    message.match(/Escalating to heavy tier \[([^\]]+)\]/i) ||
    message.match(/Primary model \[([^\]]+)\]/i) ||
    message.match(/Intermediate model \[([^\]]+)\]/i)

  if (bracketMatch && bracketMatch[1]) {
    return bracketMatch[1].trim()
  }

  return fallbackModelName || 'LLM'
}

interface AgentActionLogPanelProps {
  actionLogs: AgentActionLog[]
  agentMode: AgentMode
  setAgentMode: (mode: AgentMode) => void
  agentPrompt: string
  setAgentPrompt: (prompt: string) => void
  isExecuting: boolean
  currentStep?: number
  maxSteps?: number | string
  activeSkills?: string[]
  streamingText?: string
  onExecute: () => void
  onCancel: () => void
  pinnedFiles: Map<string, WorkspaceFile>
  ingestedDocs: IngestedDocument[]
  attachedDocIds: Set<string>
  onToggleAttachDoc: (docId: string) => void
  selectedFile: WorkspaceFile | null
  activeModelName?: string
  settings?: AppSettings
  availableModels?: string[]
  onOpenFile?: (file: WorkspaceFile) => void
  promptQueue?: QueuedPrompt[]
  onRemoveFromQueue?: (id: string) => void
  onEditPromptInQueue?: (id: string, newPrompt: string) => void
  onOpenPromptModal?: () => void
  onOpenSkillHubModal?: () => void
  onResetSession?: () => void
  onCompactContext?: () => void
  /** Drafts a plan from the current prompt without changing agentMode or replacing normal send. */
  onGeneratePlan?: () => void
  /** Shows a badge on the "Genera piano" icon when there are un-consolidated pending milestones. */
  hasPendingUnconsolidatedMilestones?: boolean
  workspacePath?: string | null
  workspaceSessions?: CodingSession[]
  activeSessionId?: string
  activeSession?: CodingSession | null
  onCreateSession?: () => void
  onSwitchSession?: (id: string) => void
  onDeleteSession?: (id: string) => void
  onRenameSession?: (id: string, title: string) => void
  onSelectWorkspaceFolder?: () => void
  /** Shared with other agent-opened panels (e.g. CodingTerminal) so one toggle governs autoscroll everywhere. */
  autoScroll: boolean
  onToggleAutoScroll: () => void
}

export const AgentActionLogPanel: React.FC<AgentActionLogPanelProps> = ({
  actionLogs,
  agentMode,
  setAgentMode,
  agentPrompt,
  setAgentPrompt,
  isExecuting,
  activeSkills = [],
  streamingText = '',
  onExecute,
  onCancel,
  pinnedFiles,
  ingestedDocs,
  attachedDocIds,
  onToggleAttachDoc,
  selectedFile,
  activeModelName,
  settings,
  availableModels,
  onOpenFile,
  promptQueue = [],
  onRemoveFromQueue,
  onEditPromptInQueue,
  onOpenPromptModal,
  onOpenSkillHubModal,
  onResetSession,
  onCompactContext,
  onGeneratePlan,
  hasPendingUnconsolidatedMilestones = false,
  workspacePath,
  workspaceSessions = [],
  activeSessionId,
  activeSession,
  onCreateSession,
  onSwitchSession,
  onDeleteSession,
  onRenameSession,
  onSelectWorkspaceFolder,
  autoScroll,
  onToggleAutoScroll,
}) => {
  const { t } = useTranslation()
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const toolsMenuRef = useRef<HTMLDivElement>(null)
  const [showToolsMenu, setShowToolsMenu] = useState(false)
  const [showSessionsDropdown, setShowSessionsDropdown] = useState(false)
  const [editingSessionTitleId, setEditingSessionTitleId] = useState<string | null>(null)
  const [sessionTitleText, setSessionTitleText] = useState<string>('')
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set())
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null)
  const [editingQueueText, setEditingQueueText] = useState<string>('')
  const isProgrammaticScrollRef = useRef<boolean>(false)
  const isUserScrolledUpRef = useRef<boolean>(false)
  const isUserInteractingRef = useRef<boolean>(false)
  const userInteractionTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [isScrolledUp, setIsScrolledUp] = useState<boolean>(false)

  // Context window tracking (reflecting actual turn prompt assembly: max 8 steps + system + prompt)
  const maxContextLimit = settings?.hardwareProfile === 'High' ? 48000 : settings?.hardwareProfile === 'Low' ? 16000 : 28000
  const recentLogs = actionLogs.slice(-8)
  const estimatedTurnChars = Math.min(
    maxContextLimit,
    2500 + agentPrompt.length + recentLogs.reduce((acc, log) => acc + log.message.length + Math.min(log.detail?.length || 0, 1200), 0)
  )
  const contextPercent = Math.min(100, Math.round((estimatedTurnChars / maxContextLimit) * 100))
  const isContextHeavy = contextPercent >= 70 || actionLogs.length > 14

  // Track explicit user scroll gestures (mouse wheel or touch)
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return

    const handleUserInteraction = (e: WheelEvent | TouchEvent) => {
      isUserInteractingRef.current = true
      if (userInteractionTimeoutRef.current) clearTimeout(userInteractionTimeoutRef.current)
      userInteractionTimeoutRef.current = setTimeout(() => {
        isUserInteractingRef.current = false
      }, 600)
    }

    el.addEventListener('wheel', handleUserInteraction, { passive: true })
    el.addEventListener('touchmove', handleUserInteraction, { passive: true })

    return () => {
      el.removeEventListener('wheel', handleUserInteraction)
      el.removeEventListener('touchmove', handleUserInteraction)
      if (userInteractionTimeoutRef.current) clearTimeout(userInteractionTimeoutRef.current)
    }
  }, [])

  const handleScroll = () => {
    if (!scrollContainerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current
    const distanceToBottom = scrollHeight - scrollTop - clientHeight

    // Automatically re-attach autoscroll whenever container reaches near-bottom (<= 25px)
    if (distanceToBottom <= 25) {
      isUserScrolledUpRef.current = false
      setIsScrolledUp(false)
    } else if (distanceToBottom > 80 && isUserInteractingRef.current) {
      // Mark as scrolled up ONLY if the user performed an explicit wheel/touch gesture
      setIsScrolledUp(true)
      isUserScrolledUpRef.current = true
    }
  }

  const scrollToBottom = (smooth = true) => {
    if (!scrollContainerRef.current) return
    isProgrammaticScrollRef.current = true
    setIsScrolledUp(false)
    isUserScrolledUpRef.current = false

    if (smooth && !isExecuting && !streamingText) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth',
      })
    } else {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
      bottomRef.current?.scrollIntoView({ behavior: 'auto' })
    }

    requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
      }
      isProgrammaticScrollRef.current = false
    })
  }

  const handleToggleAutoScroll = () => {
    const next = !autoScroll
    onToggleAutoScroll()
    if (next) {
      setIsScrolledUp(false)
      isUserScrolledUpRef.current = false
      scrollToBottom(false)
    }
  }

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

  // When execution starts, automatically reset user scroll state and scroll to bottom
  const prevExecutingRef = useRef(isExecuting)
  useEffect(() => {
    if (isExecuting && !prevExecutingRef.current) {
      setIsScrolledUp(false)
      isUserScrolledUpRef.current = false
      scrollToBottom(false)
    }
    prevExecutingRef.current = isExecuting
  }, [isExecuting])

  // Continuous Autoscroll during action logs arrival and text streaming
  useEffect(() => {
    if (!autoScroll) return
    if (isUserScrolledUpRef.current) return

    const el = scrollContainerRef.current
    if (!el) return

    isProgrammaticScrollRef.current = true
    el.scrollTop = el.scrollHeight

    const rafId = requestAnimationFrame(() => {
      if (scrollContainerRef.current && !isUserScrolledUpRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
      }
      isProgrammaticScrollRef.current = false
    })

    return () => {
      cancelAnimationFrame(rafId)
    }
  }, [actionLogs, streamingText, isExecuting, autoScroll])

  // ResizeObserver on message list to scroll to bottom as height increases during streaming
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return

    const observer = new ResizeObserver(() => {
      if (autoScroll && !isUserScrolledUpRef.current) {
        isProgrammaticScrollRef.current = true
        el.scrollTop = el.scrollHeight
        requestAnimationFrame(() => {
          isProgrammaticScrollRef.current = false
        })
      }
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [autoScroll])

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

  const projectName = workspacePath ? workspacePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'Workspace' : t('coding.noProjectAttached')

  return (
    <div className="h-full flex flex-col bg-[#0b0f17] text-slate-200 overflow-hidden select-text relative">
      {/* Project Context & Nested Sessions Header Bar */}
      <div className="p-2.5 px-4 border-b border-slate-800/90 bg-[#0d131f] flex items-center justify-between gap-3 shrink-0 z-10">
        {/* Left: Project Folder info */}
        <div className="flex items-center gap-2 min-w-0">
          {workspacePath ? (
            <button
              type="button"
              onClick={onSelectWorkspaceFolder}
              title={`Progetto: ${workspacePath}`}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-500/30 text-cyan-200 transition-all text-xs font-semibold truncate focus-ring shadow-sm"
            >
              <FolderOpen className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="truncate max-w-[140px] sm:max-w-[200px]">{projectName}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onSelectWorkspaceFolder}
              title={t('coding.selectFolder')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-cyan-300 transition-all text-xs font-medium focus-ring"
            >
              <FolderOpen className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>{t('coding.selectFolder')}</span>
            </button>
          )}
        </div>

        {/* Right: Nested Sessions Selector & New Chat */}
        <div className="flex items-center gap-1.5 relative">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowSessionsDropdown(!showSessionsDropdown)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-slate-100 transition-all text-xs font-medium focus-ring"
            >
              <MessageSquare className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span className="truncate max-w-[120px] font-semibold text-slate-200">
                {activeSession?.title || t('coding.sessionTitleDefault')}
              </span>
              <span className="text-[10px] px-1 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/60 font-mono">
                {workspaceSessions.length}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {/* Sessions Dropdown */}
            {showSessionsDropdown && (
              <div className="absolute right-0 top-full mt-1.5 w-64 rounded-2xl bg-[#0f172a] border border-slate-800 shadow-2xl p-2 z-50 space-y-1 animate-in fade-in zoom-in-95 duration-100">
                <div className="flex items-center justify-between px-2 py-1 border-b border-slate-800/80 text-[11px] font-bold text-slate-400">
                  <span>{t('coding.projectSessions')}</span>
                  <button
                    type="button"
                    onClick={() => {
                      onCreateSession?.()
                      setShowSessionsDropdown(false)
                    }}
                    className="p-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1 text-[10px] font-bold"
                    title={t('coding.newProjectSession')}
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>

                <div className="max-h-56 overflow-y-auto space-y-1 pt-1">
                  {workspaceSessions.map((session) => {
                    const isActive = session.id === activeSessionId
                    const isEditing = editingSessionTitleId === session.id

                    return (
                      <div
                        key={session.id}
                        className={`flex items-center justify-between p-1.5 rounded-xl text-xs transition-colors group ${
                          isActive
                            ? 'bg-indigo-950/70 border border-indigo-800/60 text-indigo-200'
                            : 'hover:bg-slate-800/70 text-slate-300'
                        }`}
                      >
                        {isEditing ? (
                          <div className="flex items-center gap-1 w-full">
                            <input
                              type="text"
                              value={sessionTitleText}
                              onChange={(e) => setSessionTitleText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  onRenameSession?.(session.id, sessionTitleText)
                                  setEditingSessionTitleId(null)
                                }
                                if (e.key === 'Escape') setEditingSessionTitleId(null)
                              }}
                              className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-100 outline-none"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => {
                                onRenameSession?.(session.id, sessionTitleText)
                                setEditingSessionTitleId(null)
                              }}
                              className="p-1 text-emerald-400 hover:bg-slate-800 rounded"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                onSwitchSession?.(session.id)
                                setShowSessionsDropdown(false)
                              }}
                              className="flex-1 text-left truncate flex items-center gap-1.5"
                            >
                              <MessageSquare className={`w-3 h-3 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                              <span className="truncate">{session.title}</span>
                            </button>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingSessionTitleId(session.id)
                                  setSessionTitleText(session.title)
                                }}
                                className="p-1 hover:text-cyan-300 rounded"
                                title="Rinomina sessione"
                              >
                                <Edit2 className="w-2.5 h-2.5" />
                              </button>
                              {workspaceSessions.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => onDeleteSession?.(session.id)}
                                  className="p-1 hover:text-rose-400 rounded"
                                  title="Elimina sessione"
                                >
                                  <Trash2 className="w-2.5 h-2.5" />
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Timeline Stream */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs font-mono relative"
      >
        {/* Floating Scroll-to-Bottom Button */}
        {isScrolledUp && (
          <button
            type="button"
            onClick={() => scrollToBottom(true)}
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
          actionLogs.map((log) => {
            const isUserMsg = log.message.startsWith('User Prompt: ')
            const isAgentQuestion =
              log.message.includes('❓ AI Agent Question:') ||
              log.message.startsWith('Agent Question:') ||
              log.message.startsWith('Agent requested clarification:')
            const isExpanded = expandedLogIds.has(log.id)

            // Distinct User Prompt Bubble
            if (isUserMsg) {
              const text = log.message.replace('User Prompt: ', '')
              return (
                <div key={log.id} className="p-4 rounded-2xl bg-gradient-to-r from-indigo-950/60 via-blue-950/40 to-slate-900/90 border border-indigo-500/40 text-slate-100 font-sans text-xs space-y-2 shadow-lg">
                  <div className="flex items-center justify-between border-b border-indigo-500/20 pb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-indigo-300">
                        <User className="w-3 h-3" />
                      </div>
                      <span className="font-bold text-xs text-indigo-300">{t('coding.userRole')}</span>
                    </div>
                    <span className="text-[10px] text-indigo-400/70 font-mono">{log.timestamp}</span>
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
                <div key={log.id} className="p-4 rounded-2xl bg-gradient-to-r from-amber-950/50 to-slate-900/90 border-2 border-amber-500/70 text-amber-100 font-sans text-xs space-y-2 shadow-xl animate-in fade-in duration-200">
                  <div className="flex items-center justify-between border-b border-amber-500/30 pb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-400/50 flex items-center justify-center text-amber-300">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      </div>
                      <span className="font-bold text-xs text-amber-300">{t('coding.agentQuestion')}</span>
                    </div>
                    <span className="text-[10px] text-amber-400/80 font-mono">{log.timestamp}</span>
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
                <div key={log.id} className="space-y-1.5 font-mono">
                  <button
                    type="button"
                    onClick={() => toggleExpand(log.id)}
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
                <div key={log.id} className="flex items-center justify-between text-xs py-1 px-1 rounded font-mono group">
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
                  key={log.id}
                  onClick={() => toggleExpand(log.id)}
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
              <div
                key={log.id}
                className="p-3.5 rounded-2xl bg-[#0e1422] border border-slate-800/90 text-slate-200 font-sans text-xs leading-relaxed space-y-2 shadow-md"
              >
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
                  <span className="text-[10px] text-slate-400 font-mono">{log.timestamp}</span>
                </div>
                <div className="whitespace-pre-wrap leading-relaxed">{log.message}</div>
                {log.detail && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => toggleExpand(log.id)}
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
          })
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

      {/* Prompt Queue Card */}
      {promptQueue.length > 0 && (
        <div className="mx-3 mb-1 p-2.5 bg-[#121826] border border-slate-800 rounded-xl space-y-2 text-xs shrink-0">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
            <span className="flex items-center gap-1.5 text-cyan-400">
              <Clock className="w-3.5 h-3.5" /> {t('coding.queuedPrompts', { count: promptQueue.length })}
            </span>
            <span className="text-[10px] text-slate-400 font-mono">{t('common.status')}</span>
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
                        type="button"
                        onClick={() => {
                          onEditPromptInQueue?.(item.id, editingQueueText)
                          setEditingQueueId(null)
                        }}
                        className="p-1 hover:bg-slate-800 text-emerald-400 rounded"
                        title={t('common.save')}
                      >
                        <Check className="w-3 h-3" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingQueueId(item.id)
                          setEditingQueueText(item.prompt)
                        }}
                        className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded"
                        title={t('coding.editQueuePrompt')}
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onRemoveFromQueue?.(item.id)}
                      className="p-1 hover:bg-rose-950/80 text-slate-400 hover:text-rose-400 rounded transition-colors"
                      title={t('coding.removeFromQueue')}
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

      {/* Context Window Tracking & Compaction Banner */}
      {isContextHeavy && (
        <div className="mx-3 mb-1.5 p-2.5 rounded-xl bg-amber-950/40 border border-amber-800/60 flex items-center justify-between text-xs text-amber-300 animate-in fade-in">
          <div className="flex items-center gap-2 text-[11px] font-sans">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Contesto turno: <strong>{estimatedTurnChars.toLocaleString()}</strong> / {maxContextLimit.toLocaleString()} car. ({contextPercent}%)
            </span>
          </div>
          {onCompactContext && (
            <button
              type="button"
              disabled={isExecuting}
              onClick={onCompactContext}
              className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold rounded-lg text-[10px] transition-all active:scale-95 shadow-sm"
              title="Sintetizza e rimuovi i passaggi storici più vecchi mantenendo gli ultimi step"
            >
              🧹 Compatta Contesto
            </button>
          )}
        </div>
      )}

      {/* Floating Prompt Composer Card */}
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
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowToolsMenu(!showToolsMenu)}
                  aria-label={t('chat.toolsTitle')}
                  aria-haspopup="dialog"
                  aria-expanded={showToolsMenu}
                  title={t('chat.toolsTitle')}
                  className={`px-2 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all focus-ring active:scale-95 ${
                    showToolsMenu || attachedDocIds.size > 0
                      ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/80 shadow-sm'
                      : 'bg-slate-900/90 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Plus className={`w-3.5 h-3.5 ${showToolsMenu ? 'rotate-45' : ''} transition-transform text-cyan-400`} />
                  <span className="text-[11px]">{t('chat.toolsButton')}</span>
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
                    role="dialog"
                    aria-modal="false"
                    aria-label={t('chat.toolsTitle')}
                    className="absolute bottom-full mb-2 left-0 w-72 bg-slate-900 border border-slate-800 rounded-2xl p-3 shadow-2xl space-y-3 z-30 font-sans animate-in fade-in"
                  >
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                      <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                        <Sliders className="w-3.5 h-3.5 text-cyan-400" /> {t('chat.toolsTitle')}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowToolsMenu(false)}
                        aria-label={t('common.close')}
                        className="p-1 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 focus-ring"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Section 1: RAG Documents Attachment */}
                    <div className="space-y-1.5">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                        <span>{t('chat.contextTitle', { selected: attachedDocIds.size, total: ingestedDocs.length })}</span>
                        {attachedDocIds.size > 0 && (
                          <button
                            type="button"
                            onClick={() => attachedDocIds.forEach((id) => onToggleAttachDoc(id))}
                            className="text-[9px] text-cyan-400 hover:underline"
                          >
                            {t('common.clear')}
                          </button>
                        )}
                      </div>
                      <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                        {ingestedDocs.length === 0 ? (
                          <div className="text-[11px] text-slate-400 italic p-1">{t('chat.noDocsIndexed')}</div>
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
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('common.actions')}</div>
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
                            <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> {t('skills.hubTitle')}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
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
                            <Sliders className="w-3.5 h-3.5 text-cyan-400" /> {t('chat.configurePrompt')}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Autoscroll Toggle Button */}
              <button
                type="button"
                onClick={handleToggleAutoScroll}
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
              {/* Mode Selector Pill */}
              <div className="flex items-center bg-slate-900/90 rounded-xl border border-slate-800 p-0.5 text-[10px] shrink-0" role="radiogroup" aria-label="Agent Mode">
                <button
                  type="button"
                  role="radio"
                  tabIndex={agentMode === 'plan' ? 0 : -1}
                  aria-checked={agentMode === 'plan'}
                  onClick={() => setAgentMode('plan')}
                  title={`${t('coding.planMode')}: ${t('coding.planModeDesc')}`}
                  className={`px-2 py-0.5 rounded-lg font-semibold transition-all focus-ring ${
                    agentMode === 'plan' ? 'bg-cyan-950 text-cyan-300 font-bold border border-cyan-800/80 shadow-sm' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t('coding.planModeShort')}
                </button>
                <button
                  type="button"
                  role="radio"
                  tabIndex={agentMode === 'ask' ? 0 : -1}
                  aria-checked={agentMode === 'ask'}
                  onClick={() => setAgentMode('ask')}
                  title={`${t('coding.askMode')}: ${t('coding.askModeDesc')}`}
                  className={`px-2 py-0.5 rounded-lg font-semibold transition-all focus-ring ${
                    agentMode === 'ask' ? 'bg-amber-950 text-amber-300 font-bold border border-amber-800/80 shadow-sm' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t('coding.askModeShort')}
                </button>
                <button
                  type="button"
                  role="radio"
                  tabIndex={agentMode === 'agent' ? 0 : -1}
                  aria-checked={agentMode === 'agent'}
                  onClick={() => setAgentMode('agent')}
                  title={`${t('coding.agentMode')}: ${t('coding.agentModeDesc')}`}
                  className={`px-2 py-0.5 rounded-lg font-semibold transition-all focus-ring ${
                    agentMode === 'agent' ? 'bg-emerald-950 text-emerald-300 font-bold border border-emerald-800/80 shadow-sm' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t('coding.agentModeShort')}
                </button>
              </div>



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
                  aria-label={t('coding.queuedPrompts', { count: promptQueue.length })}
                  title={t('coding.queuedPrompts', { count: promptQueue.length })}
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
    </div>
  )
}
