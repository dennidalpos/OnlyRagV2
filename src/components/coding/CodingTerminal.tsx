import React, { useRef, useEffect, useState } from 'react'
import { ArrowDown, Play, Terminal as TerminalIcon, Trash2, Copy, Check } from 'lucide-react'
import { useToast } from '../common/Toast'
import { useTranslation } from '../../i18n'

interface CodingTerminalProps {
  terminalLogs: string[]
  terminalInput: string
  setTerminalInput: (val: string) => void
  onRunCommand: () => void
  onClearTerminal?: () => void
  isExecuting: boolean
  /** Shared with AgentActionLogPanel so the single autoscroll toggle governs every agent-opened panel. */
  autoScroll: boolean
}

export const CodingTerminal: React.FC<CodingTerminalProps> = ({
  terminalLogs,
  terminalInput,
  setTerminalInput,
  onRunCommand,
  onClearTerminal,
  isExecuting,
  autoScroll,
}) => {
  const { t } = useTranslation()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const toast = useToast()
  const isProgrammaticScrollRef = useRef<boolean>(false)
  const isUserInteractingRef = useRef<boolean>(false)
  const userInteractionTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [isUserScrolledUp, setIsUserScrolledUp] = useState<boolean>(false)
  const [copied, setCopied] = useState<boolean>(false)

  // Track explicit user scroll gestures (mouse wheel or touch)
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return

    const handleUserInteraction = () => {
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

    if (distanceToBottom <= 25) {
      setIsUserScrolledUp(false)
    } else if (distanceToBottom > 60 && isUserInteractingRef.current) {
      setIsUserScrolledUp(true)
    }
  }

  const scrollToBottom = () => {
    if (!scrollContainerRef.current) return
    isProgrammaticScrollRef.current = true
    setIsUserScrolledUp(false)
    scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
      }
      isProgrammaticScrollRef.current = false
    })
  }

  const handleCopyLogs = async () => {
    const text = terminalLogs.join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    toast.success(t('diagnostics.logsCopied'))
    setTimeout(() => setCopied(false), 2000)
  }

  // Reset scroll on new execution
  const prevExecutingRef = useRef(isExecuting)
  useEffect(() => {
    if (isExecuting && !prevExecutingRef.current) {
      setIsUserScrolledUp(false)
      scrollToBottom()
    }
    prevExecutingRef.current = isExecuting
  }, [isExecuting])

  useEffect(() => {
    if (autoScroll && !isUserScrolledUp && scrollContainerRef.current) {
      isProgrammaticScrollRef.current = true
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
      const rafId = requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
        }
        isProgrammaticScrollRef.current = false
      })
      return () => cancelAnimationFrame(rafId)
    }
  }, [terminalLogs, isExecuting, isUserScrolledUp, autoScroll])

  return (
    <div className="h-full flex flex-col p-3.5 font-mono text-xs bg-[#0b0f17] relative">
      {/* Terminal Top Control Bar */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/80 shrink-0 text-slate-400">
        <div className="flex items-center gap-2 text-[11px] font-sans font-semibold text-slate-300">
          <TerminalIcon className="w-3.5 h-3.5 text-cyan-400" />
          <span>{t('coding.terminalOutput')}</span>
        </div>

        <div className="flex items-center gap-1.5 font-sans">
          <button
            type="button"
            onClick={handleCopyLogs}
            disabled={terminalLogs.length === 0}
            aria-label={t('common.copy')}
            className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg transition-colors disabled:opacity-40 focus-ring"
            title={t('common.copy')}
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          {onClearTerminal && (
            <button
              type="button"
              onClick={onClearTerminal}
              disabled={terminalLogs.length === 0 || isExecuting}
              aria-label={t('coding.clearTerminal')}
              className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-rose-400 rounded-lg transition-colors disabled:opacity-40 focus-ring"
              title={t('coding.clearTerminal')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Terminal Output Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto space-y-1 text-slate-300 font-mono text-[11px] select-text pr-1"
      >
        {terminalLogs.map((log, idx) => (
          <div key={idx} className="whitespace-pre-wrap leading-relaxed">
            {log}
          </div>
        ))}
        {isExecuting && (
          <div className="flex items-center gap-2 text-cyan-400 font-semibold py-1">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            <span>{t('common.loading')}</span>
          </div>
        )}
      </div>

      {/* Floating Scroll-to-Bottom Button */}
      {isUserScrolledUp && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label={t('diagnostics.autoScroll')}
          className="absolute bottom-16 right-6 px-3 py-1.5 bg-cyan-950/90 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-300 text-xs rounded-full shadow-xl backdrop-blur-sm flex items-center gap-1.5 transition-all animate-in fade-in duration-200 z-10 font-sans font-semibold active:scale-95"
        >
          <ArrowDown className="w-3.5 h-3.5 animate-bounce text-cyan-400" />
          <span>{t('common.back')}</span>
        </button>
      )}

      {/* Terminal Input Bar */}
      <div className="mt-2.5 flex items-center gap-2 pt-2.5 border-t border-slate-800/80">
        <span className="text-cyan-400 font-bold font-mono">PS &gt;</span>
        <input
          type="text"
          aria-label="PowerShell Input"
          value={terminalInput}
          onChange={(e) => setTerminalInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRunCommand()
          }}
          placeholder={t('coding.terminalInputPlaceholder')}
          className="flex-1 bg-[#030712] border border-slate-700 focus:border-cyan-500 rounded-xl px-3 py-1.5 text-slate-100 placeholder:text-slate-400 outline-none font-mono text-xs focus-ring"
        />
        <button
          type="button"
          onClick={onRunCommand}
          disabled={isExecuting || !terminalInput.trim()}
          aria-label={t('coding.runCommand')}
          className="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold rounded-xl text-xs transition-all flex items-center gap-1 active:scale-95 focus-ring shadow-md shadow-cyan-950/40"
        >
          <Play className="w-3 h-3 fill-current" />
          <span>{t('coding.runCommand')}</span>
        </button>
      </div>
    </div>
  )
}
