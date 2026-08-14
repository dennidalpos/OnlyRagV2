import React, { useRef, useEffect, useState } from 'react'
import { ArrowDown, Play, Terminal as TerminalIcon, Trash2, Copy, Check } from 'lucide-react'
import { useToast } from '../common/Toast'

interface CodingTerminalProps {
  terminalLogs: string[]
  terminalInput: string
  setTerminalInput: (val: string) => void
  onRunCommand: () => void
  onClearTerminal?: () => void
  isExecuting: boolean
}

export const CodingTerminal: React.FC<CodingTerminalProps> = ({
  terminalLogs,
  terminalInput,
  setTerminalInput,
  onRunCommand,
  onClearTerminal,
  isExecuting,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const toast = useToast()
  const [isUserScrolledUp, setIsUserScrolledUp] = useState<boolean>(false)
  const [copied, setCopied] = useState<boolean>(false)

  const handleScroll = () => {
    if (!scrollContainerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current
    const isNearBottom = scrollHeight - scrollTop - clientHeight <= 45
    setIsUserScrolledUp(!isNearBottom)
  }

  const scrollToBottom = () => {
    if (!scrollContainerRef.current) return
    scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    setIsUserScrolledUp(false)
  }

  const handleCopyLogs = async () => {
    const text = terminalLogs.join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    toast.success('Log del terminale copiati negli appunti!')
    setTimeout(() => setCopied(false), 2000)
  }

  useEffect(() => {
    if (!isUserScrolledUp && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [terminalLogs, isExecuting, isUserScrolledUp])

  return (
    <div className="h-full flex flex-col p-4 font-mono text-xs bg-[#0b0f17] relative">
      {/* Terminal Top Control Bar */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/80 shrink-0 text-slate-400">
        <div className="flex items-center gap-2 text-[11px] font-sans font-semibold text-slate-300">
          <TerminalIcon className="w-3.5 h-3.5 text-cyan-400" />
          <span>Sessione PowerShell Integrata</span>
        </div>

        <div className="flex items-center gap-1.5 font-sans">
          <button
            type="button"
            onClick={handleCopyLogs}
            aria-label="Copia log terminale"
            title="Copia l'intero output del terminale"
            className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 text-[11px] rounded-lg transition-colors flex items-center gap-1 focus-ring"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-slate-400" />}
            <span>Copia Output</span>
          </button>

          {onClearTerminal && (
            <button
              type="button"
              onClick={() => {
                onClearTerminal()
                toast.info('Terminale svuotato')
              }}
              aria-label="Pulisci terminale"
              title="Pulisci output del terminale"
              className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-rose-300 text-[11px] rounded-lg transition-colors flex items-center gap-1 focus-ring"
            >
              <Trash2 className="w-3 h-3 text-slate-400" />
              <span>Pulisci</span>
            </button>
          )}
        </div>
      </div>

      {/* Logs Viewport */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto space-y-1 text-slate-300 select-text pr-2 font-mono"
        tabIndex={0}
        aria-label="PowerShell Output Terminal"
      >
        {terminalLogs.map((log, idx) => (
          <div key={idx} className="whitespace-pre-wrap leading-relaxed">
            {log}
          </div>
        ))}
        {isExecuting && (
          <div className="flex items-center gap-2 text-cyan-400 font-semibold py-1">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            <span>Esecuzione comando PowerShell in corso...</span>
          </div>
        )}
      </div>

      {/* Floating Scroll-to-Bottom Button */}
      {isUserScrolledUp && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Scorri verso il basso nel terminale"
          className="absolute bottom-16 right-6 px-3 py-1.5 bg-cyan-950/90 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-300 text-xs rounded-full shadow-xl backdrop-blur-sm flex items-center gap-1.5 transition-all animate-in fade-in duration-200 z-10 font-sans font-semibold active:scale-95"
        >
          <ArrowDown className="w-3.5 h-3.5 animate-bounce text-cyan-400" />
          <span>Scorri in basso</span>
        </button>
      )}

      {/* Terminal Input Bar */}
      <div className="mt-3 flex items-center gap-2 pt-3 border-t border-slate-800/80">
        <span className="text-cyan-400 font-bold font-mono">PS &gt;</span>
        <input
          type="text"
          aria-label="Comando PowerShell"
          value={terminalInput}
          onChange={(e) => setTerminalInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRunCommand()
          }}
          placeholder="Esegui comando (es. npm test, git status, dir)..."
          className="flex-1 bg-[#030712] border border-slate-800 rounded-xl px-3 py-1.5 text-slate-200 outline-none font-mono text-xs focus-ring"
        />
        <button
          onClick={onRunCommand}
          disabled={isExecuting || !terminalInput.trim()}
          aria-label="Esegui comando da terminale"
          className="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-slate-950 font-bold rounded-xl text-xs transition-colors flex items-center gap-1"
        >
          <Play className="w-3 h-3 fill-current" />
          <span>Esegui</span>
        </button>
      </div>
    </div>
  )
}
