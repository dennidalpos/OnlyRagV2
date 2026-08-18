import React from 'react'
import { Code2, Hash } from 'lucide-react'

interface RenderedPagePreviewProps {
  pageNumber: number
  pageContent: string
}

// Always rendered nested inside SourcePagePreview's own page card, which already owns the
// per-page id, data-page-number and zoom scale transform used for page navigation/sync -- this
// component only renders the text-fallback content itself, it does not repeat that plumbing.
export const RenderedPagePreview: React.FC<RenderedPagePreviewProps> = ({
  pageNumber,
  pageContent,
}) => {
  const lines = pageContent.split('\n')

  return (
    <div className="w-full flex justify-center py-2 select-text">
      <div className="w-full max-w-2xl bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 shadow-lg min-h-[540px] flex flex-col space-y-3">
        {/* No per-page header here: the parent SourcePagePreview card (and the pane toolbar above
            it) already display the current page position -- repeating it here duplicated the same
            text twice, stacked directly on top of each other, whenever a page has no scanned image
            and falls back to this text-only renderer. */}
        <div className="space-y-3 text-xs leading-relaxed text-slate-200 font-sans flex-1">
          {lines.map((line, idx) => {
            const trimmed = line.trim()

            // Skip redundant "# Page X" or "## Page X" if it duplicates page title
            if (/^#{1,3}\s+Page\s+\d+$/i.test(trimmed)) {
              return null
            }

            // Header 1 (# Title)
            if (trimmed.startsWith('# ')) {
              return (
                <h1 key={idx} className="text-sm font-bold text-slate-100 pb-1.5 border-b border-slate-800/80 flex items-center gap-1.5 mt-3 first:mt-0">
                  <Hash className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>{trimmed.slice(2)}</span>
                </h1>
              )
            }

            // Header 2 (## Subheading)
            if (trimmed.startsWith('## ')) {
              return (
                <h2 key={idx} className="text-xs font-bold text-cyan-300 pb-1 border-b border-slate-800/50 flex items-center gap-1.5 mt-2.5">
                  <Hash className="w-3 h-3 text-cyan-400/70 shrink-0" />
                  <span>{trimmed.slice(3)}</span>
                </h2>
              )
            }

            // Header 3 (### Sub-subheading)
            if (trimmed.startsWith('### ')) {
              return (
                <h3 key={idx} className="text-xs font-semibold text-slate-200 mt-2 text-cyan-200">
                  {trimmed.slice(4)}
                </h3>
              )
            }

            // Table Row (Markdown Pipe Table)
            if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
              const cells = trimmed
                .slice(1, -1)
                .split('|')
                .map((c) => c.trim())

              const isSeparator = cells.every((c) => /^:?-+:?$/.test(c))
              if (isSeparator) return null

              return (
                <div key={idx} className="overflow-x-auto my-1">
                  <div className="inline-flex min-w-full border border-slate-800 bg-slate-950/60 rounded-lg overflow-hidden text-[11px] font-mono">
                    {cells.map((cell, cIdx) => (
                      <div
                        key={cIdx}
                        className={`px-3 py-1.5 border-r border-slate-800/80 last:border-r-0 flex-1 ${
                          cIdx === 0 ? 'bg-slate-900/60 font-semibold text-cyan-300' : 'text-slate-300'
                        }`}
                      >
                        {cell || '-'}
                      </div>
                    ))}
                  </div>
                </div>
              )
            }

            // Code Block Fence
            if (trimmed.startsWith('```')) {
              return (
                <div key={idx} className="flex items-center gap-1 text-[10px] font-mono text-cyan-400/80 pt-1">
                  <Code2 className="w-3 h-3" />
                  <span>{trimmed.slice(3) || 'code'}</span>
                </div>
              )
            }

            // Blockquote
            if (trimmed.startsWith('> ')) {
              return (
                <blockquote key={idx} className="pl-3 py-1 border-l-2 border-cyan-500 bg-cyan-950/20 text-cyan-200 rounded-r text-xs italic my-1.5">
                  {trimmed.slice(2)}
                </blockquote>
              )
            }

            // Unordered List
            if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
              return (
                <li key={idx} className="ml-4 list-disc text-slate-300 marker:text-cyan-400 text-xs">
                  {trimmed.slice(2)}
                </li>
              )
            }

            // Empty Line
            if (!trimmed) {
              return <div key={idx} className="h-1.5" />
            }

            // Standard Paragraph
            return (
              <p key={idx} className="text-slate-300 leading-relaxed font-sans text-xs">
                {line}
              </p>
            )
          })}
        </div>
      </div>
    </div>
  )
}

