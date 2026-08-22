import React, { useRef, useEffect, useState } from 'react'
import { ArrowDown, Play, Terminal as TerminalIcon, Trash2, Copy, Check, ShieldCheck, CornerDownLeft } from 'lucide-react'
import { useToast } from '../common/Toast'
import { useTranslation } from '../../i18n'

interface CodingTerminalProps {
  terminalLogs: string[]
  terminalInput: string
  setTerminalInput: (val: string) => void
  onRunCommand: () => void
  onClearTerminal?: () => void
  isExecuting: boolean
  autoScroll: boolean
  navigateHistory?: (direction: 'up' | 'down') => void
  workspacePath?: string | null
}

export const CodingTerminal: React.FC<CodingTerminalProps> = ({
  terminalLogs,
  terminalInput,
  setTerminalInput,
  onRunCommand,
  onClearTerminal,
  isExecuting,
  autoScroll,
  navigateHistory,
  workspacePath,
}) => {
  const { t } = useTranslation()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onRunCommand()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      navigateHistory?.('up')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      navigateHistory?.('down')
    }
  }

  return (
    <div className="h-full flex flex-col p-4 font-mono text-xs bg-[#080c14] relative select-text">
      {/* Terminal Top Control Bar */}
      <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-slate-800/80 shrink-0 text-slate-400">
        <div className="flex items-center gap-2 text-xs font-sans font-semibold text-slate-200">
          <div className="w-5 h-5 rounded-md bg-cyan-950/80 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-sm">
            <TerminalIcon className="w-3 h-3" />
          </div>
          <span className="font-bold text-slate-100">{t('coding.terminalOutput')}</span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950/60 text-emerald-400 border border-emerald-800/60 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>PowerShell UTF-8</span>
          </span>
          {workspacePath && (
            <span className="text-[10px] font-mono text-slate-400 truncate max-w-xs hidden md:inline-block">
              {workspacePath}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 font-sans">
          <span className="text-[10px] font-mono text-slate-400 px-2 py-0.5 rounded bg-slate-900/80 border border-slate-800">
            {terminalLogs.length} righe
          </span>

          <button
            type="button"
            onClick={handleCopyLogs}
            disabled={terminalLogs.length === 0}
            aria-label={t('common.copy')}
            className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg transition-colors disabled:opacity-40 focus-ring cursor-pointer"
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
              className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-rose-400 rounded-lg transition-colors disabled:opacity-40 focus-ring cursor-pointer"
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
        className="flex-1 overflow-y-auto space-y-1 text-slate-300 font-mono text-[11px] select-text pr-1 rounded-xl bg-slate-950/60 p-3 border border-slate-900"
      >
        {terminalLogs.map((log, idx) => {
          const isCommand = log.startsWith('PS>') || log.startsWith('PS ')
          const isError = log.includes('Exit Code: 1') || log.includes('Error:') || log.includes('error:') || log.includes('CommandNotFoundException')
          const isSuccess = log.includes('Command executed successfully') || log.includes('PASS')
          return (
            <div
              key={idx}
              className={`whitespace-pre-wrap leading-relaxed ${
                isCommand
                  ? 'text-cyan-300 font-semibold bg-cyan-950/20 px-2 py-0.5 rounded border-l-2 border-cyan-400 my-0.5'
                  : isError
                  ? 'text-rose-300 bg-rose-950/20 px-2 py-0.5 rounded border-l-2 border-rose-500 my-0.5'
                  : isSuccess
                  ? 'text-emerald-300'
                  : 'text-slate-300'
              }`}
            >
              {log}
            </div>
          )
        })}
        {isExecuting && (
          <div className="flex items-center gap-2 text-cyan-400 font-semibold py-1.5 px-2 bg-cyan-950/30 rounded border border-cyan-800/40">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            <span>Esecuzione comando in background in corso...</span>
          </div>
        )}
      </div>

      {/* Floating Scroll-to-Bottom Button */}
      {isUserScrolledUp && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label={t('diagnostics.autoScroll')}
          className="absolute bottom-20 right-6 px-3 py-1.5 bg-cyan-950/90 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-300 text-xs rounded-full shadow-xl backdrop-blur-sm flex items-center gap-1.5 transition-all animate-in fade-in duration-200 z-10 font-sans font-semibold active:scale-95 cursor-pointer"
        >
          <ArrowDown className="w-3.5 h-3.5 animate-bounce text-cyan-400" />
          <span>In fondo</span>
        </button>
      )}

      {/* Terminal Input Bar */}
      <div className="mt-3 flex items-center gap-2 pt-2.5 border-t border-slate-800/80">
        <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-cyan-400 font-bold font-mono text-xs shrink-0 select-none shadow-inner">
          <ShieldCheck className="w-3 h-3 text-cyan-400" />
          <span>PS &gt;</span>
        </div>
        <input
          ref={inputRef}
          type="text"
          aria-label="PowerShell Input"
          value={terminalInput}
          onChange={(e) => setTerminalInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Esegui comando PowerShell... (↑/↓ per cronologia comandi)"
          className="flex-1 bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl px-3.5 py-2 text-slate-100 placeholder:text-slate-500 outline-none font-mono text-xs focus-ring shadow-inner"
        />
        <button
          type="button"
          onClick={onRunCommand}
          disabled={isExecuting || !terminalInput.trim()}
          aria-label={t('coding.runCommand')}
          className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold rounded-xl text-xs transition-all flex items-center gap-1.5 active:scale-95 focus-ring shadow-md shadow-cyan-950/40 cursor-pointer shrink-0"
        >
          <Play className="w-3 h-3 fill-current" />
          <span>Esegui</span>
          <CornerDownLeft className="w-3 h-3 opacity-60 ml-0.5" />
        </button>
      </div>
    </div>
  )
}
