import React, { useMemo } from 'react'
import { collapseContext, type DiffLine } from '../../../electron/core/domain/agent/diffEngine'

const LINE_STYLE: Record<DiffLine['type'], { row: string; marker: string; sign: string }> = {
  add: { row: 'bg-emerald-950/40 text-emerald-200', marker: 'text-emerald-400', sign: '+' },
  del: { row: 'bg-rose-950/40 text-rose-200', marker: 'text-rose-400', sign: '-' },
  context: { row: 'text-slate-400', marker: 'text-slate-600', sign: ' ' },
}

interface DiffLinesViewProps {
  lines: ReadonlyArray<DiffLine>
  /** Elide long unchanged runs, keeping `contextRadius` lines around each change. */
  collapse?: boolean
  contextRadius?: number
}

/**
 * Renders a flat line diff: old/new line numbers, a +/- marker, and the line content,
 * green for additions and red for deletions. Shared by the git diff panel (one call per
 * hunk) and the pending-approval modal (one call for the whole before/after pair).
 */
export const DiffLinesView: React.FC<DiffLinesViewProps> = ({ lines, collapse = false, contextRadius = 3 }) => {
  const entries = useMemo(
    () => (collapse ? collapseContext(lines, contextRadius) : lines.map((line) => ({ kind: 'line' as const, line }))),
    [lines, collapse, contextRadius]
  )

  return (
    <table className="w-full border-collapse font-mono text-[11px] leading-relaxed">
      <tbody>
        {entries.map((entry, idx) => {
          if (entry.kind === 'gap') {
            return (
              <tr key={`gap-${idx}`} className="bg-slate-900/40">
                <td colSpan={4} className="px-3 py-0.5 text-[10px] text-slate-500 italic select-none">
                  … {entry.hiddenCount} righe invariate
                </td>
              </tr>
            )
          }

          const style = LINE_STYLE[entry.line.type]
          return (
            <tr key={idx} className={style.row}>
              <td className="px-2 text-right text-slate-600 select-none w-12 align-top">
                {entry.line.oldLineNumber ?? ''}
              </td>
              <td className="px-2 text-right text-slate-600 select-none w-12 align-top border-r border-slate-800/80">
                {entry.line.newLineNumber ?? ''}
              </td>
              <td className={`pl-2 pr-1 select-none w-4 align-top ${style.marker}`}>{style.sign}</td>
              <td className="pr-3 whitespace-pre select-text">{entry.line.content}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** Compact "+N −M" pair, shared by every surface that reports diff size. */
export const ChangeCounts: React.FC<{ additions: number; deletions: number }> = ({ additions, deletions }) => (
  <span className="flex items-center gap-1.5 font-mono text-[10px] shrink-0">
    <span className="text-emerald-400">+{additions}</span>
    <span className="text-rose-400">−{deletions}</span>
  </span>
)
