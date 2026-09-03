import React, { useMemo } from 'react'
import { GitBranch, RefreshCw, CheckCircle2, FileCode } from 'lucide-react'
import stripAnsi from 'strip-ansi'
import {
  parseUnifiedDiff,
  summarizeDiff,
  type DiffFileChange,
} from '../../../shared/domain/agent/diffEngine'
import { DiffLinesView, ChangeCounts } from './DiffLinesView'

interface GitDiffPanelProps {
  gitStatusLines: string[]
  gitDiffText: string
  isFetchingGit: boolean
  isGitRepo?: boolean
  onRefreshGit: () => void
  onInitGit?: () => void
}

const STATUS_BADGE: Record<DiffFileChange['status'], { label: string; className: string }> = {
  added: { label: 'added', className: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/70' },
  deleted: { label: 'deleted', className: 'bg-rose-950/60 text-rose-300 border-rose-800/70' },
  renamed: { label: 'renamed', className: 'bg-amber-950/60 text-amber-300 border-amber-800/70' },
  modified: { label: 'modified', className: 'bg-cyan-950/60 text-cyan-300 border-cyan-800/70' },
}

const DiffFileCard: React.FC<{ file: DiffFileChange }> = ({ file }) => {
  const badge = STATUS_BADGE[file.status]

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-slate-900/80 border-b border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          <FileCode className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span className="font-mono text-[11px] text-slate-200 truncate" title={file.displayPath}>
            {file.status === 'renamed' ? `${file.oldPath} → ${file.newPath}` : file.displayPath}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ChangeCounts additions={file.additions} deletions={file.deletions} />
          <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${badge.className}`}>
            {badge.label}
          </span>
        </div>
      </div>

      {file.isBinary ? (
        <div className="px-3 py-2 text-[11px] text-slate-400 italic">File binario — diff non visualizzabile.</div>
      ) : (
        <div className="overflow-x-auto">
          {file.hunks.map((hunk, hunkIdx) => (
            <div key={`${hunk.header}-${hunkIdx}`}>
              <div className="px-3 py-1 bg-slate-900/60 text-[10px] font-mono text-cyan-300/80 whitespace-pre">
                {hunk.header}
              </div>
              <DiffLinesView lines={hunk.lines} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export const GitDiffPanel: React.FC<GitDiffPanelProps> = ({
  gitStatusLines,
  gitDiffText,
  isFetchingGit,
  isGitRepo = true,
  onRefreshGit,
  onInitGit,
}) => {
  const cleanStatusLines = useMemo(() => {
    return gitStatusLines
      .map((str) => stripAnsi(str).trim())
      .filter(
        (l) =>
          l &&
          !l.startsWith(']0;') &&
          !l.includes('powershell.exe') &&
          !l.toLowerCase().includes('no modified files detected') &&
          !l.toLowerCase().includes('not a git repository')
      )
  }, [gitStatusLines])

  const cleanDiffText = useMemo(() => {
    const raw = stripAnsi(gitDiffText).trim()
    return raw.toLowerCase().includes('no uncommitted changes') ? '' : raw
  }, [gitDiffText])

  // Parsed once per diff payload: the panel re-renders on every poll of the git status.
  const parsedFiles = useMemo(() => parseUnifiedDiff(cleanDiffText), [cleanDiffText])
  const totals = useMemo(() => summarizeDiff(parsedFiles), [parsedFiles])

  const notGitRepo =
    isGitRepo === false ||
    gitStatusLines.some((l) => l.toLowerCase().includes('not a git repository')) ||
    cleanDiffText.toLowerCase().includes('not a git repository')

  const isWorkingTreeClean = !notGitRepo && cleanStatusLines.length === 0

  return (
    <div className="flex-1 h-full flex flex-col bg-slate-950 select-text">
      {/* Panel Header */}
      <div className="h-11 px-3 bg-slate-900/60 border-b border-slate-800 flex items-center justify-between shrink-0 font-sans">
        <div className="flex items-center gap-2 text-xs text-slate-300 font-semibold">
          <GitBranch className="w-4 h-4 text-cyan-400" />
          <span>Git Status &amp; Working Tree Diff</span>
          {totals.files > 0 && (
            <span className="flex items-center gap-2 pl-2 ml-1 border-l border-slate-700">
              <span className="text-[10px] font-mono text-slate-400">
                {totals.files} file{totals.files === 1 ? '' : 's'}
              </span>
              <ChangeCounts additions={totals.additions} deletions={totals.deletions} />
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onRefreshGit}
          aria-label="Aggiorna stato Git e visualizzazione diff"
          disabled={isFetchingGit}
          className="px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 font-mono transition-all focus-ring active:scale-95 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetchingGit ? 'animate-spin text-cyan-400' : ''}`} /> Refresh
        </button>
      </div>

      {notGitRepo ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-3 text-slate-400">
          <div className="p-3 rounded-2xl bg-amber-950/30 border border-amber-800/50 text-amber-400">
            <GitBranch className="w-8 h-8 opacity-80" />
          </div>
          <div className="font-bold text-slate-200 text-sm">Non è un repository Git</div>
          <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
            La cartella del progetto corrente non contiene una repository Git (<code>.git</code> non trovato). Inizializza Git per tracciare le modifiche.
          </p>
          {onInitGit && (
            <button
              type="button"
              onClick={onInitGit}
              disabled={isFetchingGit}
              className="mt-2 px-4 py-2 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg transition-all focus-ring active:scale-95 cursor-pointer disabled:opacity-50"
            >
              Inizializza Git Repository
            </button>
          )}
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
            ) : parsedFiles.length > 0 ? (
              <div
                tabIndex={0}
                aria-label="Diff colorato per file, righe aggiunte in verde e rimosse in rosso"
                className="h-full overflow-auto space-y-3 focus-ring rounded-xl"
              >
                {parsedFiles.map((file, idx) => (
                  <DiffFileCard key={`${file.displayPath}-${idx}`} file={file} />
                ))}
              </div>
            ) : (
              // Not parseable as a unified diff (e.g. a git error message): show it verbatim
              // rather than silently rendering nothing.
              <pre
                tabIndex={0}
                aria-label="Output git non riconosciuto come diff unificato"
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
