import React from 'react'
import { GitBranch, RefreshCw, CheckCircle2, FileCode } from 'lucide-react'

interface GitDiffPanelProps {
  gitStatusLines: string[]
  gitDiffText: string
  isFetchingGit: boolean
  onRefreshGit: () => void
}

export const GitDiffPanel: React.FC<GitDiffPanelProps> = ({
  gitStatusLines,
  gitDiffText,
  isFetchingGit,
  onRefreshGit,
}) => {
  // Strip ANSI escape sequences and control characters
  const stripAnsi = (str: string) =>
    str
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\[\?[0-9]+[hl]/g, '')
      .replace(/\]0;[^\x07\n]*/g, '')
      .trim()

  const cleanStatusLines = gitStatusLines
    .map(stripAnsi)
    .filter((l) => l && !l.startsWith(']0;') && !l.includes('powershell.exe'))

  const cleanDiffText = stripAnsi(gitDiffText)

  const isNotGitRepo = cleanStatusLines.some((l) => l.toLowerCase().includes('not a git repository')) || cleanDiffText.toLowerCase().includes('not a git repository')

  const isWorkingTreeClean = !isNotGitRepo && (cleanStatusLines.length === 0 || (cleanStatusLines.length === 1 && !cleanStatusLines[0]))

  return (
    <div className="flex-1 h-full flex flex-col bg-slate-950 select-text">
      {/* Panel Header */}
      <div className="p-3 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 text-xs text-slate-300 font-semibold">
          <GitBranch className="w-4 h-4 text-cyan-400" />
          <span>Git Status &amp; Working Tree Diff</span>
        </div>
        <button
          type="button"
          onClick={onRefreshGit}
          aria-label="Aggiorna stato Git e visualizzazione diff"
          disabled={isFetchingGit}
          className="px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 font-mono transition-all focus-ring active:scale-95"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetchingGit ? 'animate-spin text-cyan-400' : ''}`} /> Refresh
        </button>
      </div>

      {isNotGitRepo ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-3 text-slate-400">
          <div className="p-3 rounded-2xl bg-amber-950/30 border border-amber-800/50 text-amber-400">
            <GitBranch className="w-8 h-8 opacity-80" />
          </div>
          <div className="font-bold text-slate-200 text-sm">Non è un repository Git</div>
          <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
            La cartella del progetto corrente non contiene una repository Git (<code>.git</code> non trovato). Inizializza Git per tracciare le modifiche.
          </p>
        </div>
      ) : (
        <>
          {/* Git Status Section */}
          <div
            tabIndex={0}
            aria-label="Elenco modifiche git status"
            className="p-3 bg-slate-950 border-b border-slate-800 text-xs font-mono text-slate-300 max-h-36 overflow-y-auto space-y-1.5 focus:outline-none focus:bg-slate-900/40"
          >
            <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider flex items-center justify-between">
              <span>Git Status:</span>
              {isWorkingTreeClean && (
                <span className="text-emerald-400 text-[10px] font-mono flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Clean Working Tree
                </span>
              )}
            </div>
            {isWorkingTreeClean ? (
              <div className="text-slate-400 italic text-[11px] py-1">
                Nessuna modifica non committata rilevata nel workspace.
              </div>
            ) : (
              cleanStatusLines.map((line, idx) => {
                const isModified = line.startsWith(' M') || line.startsWith('M ')
                const isAdded = line.startsWith('??') || line.startsWith('A ')
                const isDeleted = line.startsWith(' D') || line.startsWith('D ')
                return (
                  <div
                    key={idx}
                    className={`truncate px-2 py-0.5 rounded text-[11px] ${
                      isModified
                        ? 'text-cyan-300 bg-cyan-950/30'
                        : isAdded
                        ? 'text-emerald-300 bg-emerald-950/30'
                        : isDeleted
                        ? 'text-rose-300 bg-rose-950/30'
                        : 'text-slate-300'
                    }`}
                  >
                    {line}
                  </div>
                )
              })
            )}
          </div>

          {/* Git Diff Content View */}
          <div className="flex-1 overflow-hidden p-3 bg-slate-950">
            {!cleanDiffText ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2 text-slate-400">
                <FileCode className="w-8 h-8 text-cyan-500/30" />
                <div className="font-semibold text-slate-400 text-xs">Nessun Diff Attivo</div>
                <p className="text-[11px] max-w-xs text-slate-400">
                  I file modificati dall'AI Coding Agent o dall'editor appariranno qui sotto forma di diff unificato.
                </p>
              </div>
            ) : (
              <pre
                tabIndex={0}
                aria-label="Output git diff dettagliato"
                className="h-full w-full bg-slate-950 text-slate-200 font-mono text-xs p-4 overflow-auto rounded-xl border border-slate-800 whitespace-pre leading-relaxed focus-ring"
              >
                {cleanDiffText}
              </pre>
            )}
          </div>
        </>
      )}
    </div>
  )
}

