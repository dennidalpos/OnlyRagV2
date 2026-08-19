import React, { useEffect } from 'react'
import { Search, X, AlertTriangle, Sparkles, FolderGit2, ArrowRight } from 'lucide-react'
import { WorkspaceProject } from '../../types'
import { usePromptHistorySearch } from '../../hooks/usePromptHistorySearch'
import { formatDateTime } from '../../lib/timeFormat'
import { useTranslation } from '../../i18n'
import { OUTCOME_STYLES } from './SessionHistoryTree'

interface PromptHistorySearchModalProps {
  isOpen: boolean
  onClose: () => void
  projects: WorkspaceProject[]
  onJump: (projectPath: string, sessionId: string) => void
}

function resolveProjectName(projects: WorkspaceProject[], projectPath: string): string {
  const known = projects.find((p) => p.path === projectPath)
  if (known) return known.name
  return projectPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || projectPath
}

export const PromptHistorySearchModal: React.FC<PromptHistorySearchModalProps> = ({ isOpen, onClose, projects, onJump }) => {
  const { t } = useTranslation()
  const { query, setQuery, results, isSearching, error, hasSearched, search, reset } = usePromptHistorySearch()

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen) reset()
  }, [isOpen, reset])

  if (!isOpen) return null

  const handleJump = (projectPath: string, sessionId: string) => {
    onJump(projectPath, sessionId)
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-history-search-modal-title"
      className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl flex flex-col shadow-2xl overflow-hidden max-h-[90vh]">
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center">
              <FolderGit2 className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h2 id="prompt-history-search-modal-title" className="text-base font-bold text-slate-100">
                {t('promptHistorySearch.modalTitle')}
              </h2>
              <p className="text-xs text-slate-400">{t('promptHistorySearch.modalSubtitle')}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-2 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-xl transition-colors focus-ring active:scale-95"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 border-b border-slate-800 bg-slate-950/40 shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              search(query)
            }}
            className="flex items-center gap-3"
          >
            <div className="relative flex-1">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
                aria-label={t('promptHistorySearch.queryPlaceholder')}
                placeholder={t('promptHistorySearch.queryPlaceholder')}
                className="w-full bg-slate-950 border border-slate-800 focus-within:border-indigo-500 rounded-xl px-4 py-3 text-xs text-slate-100 outline-none focus-ring font-mono placeholder:text-slate-400 leading-relaxed shadow-inner"
              />
            </div>

            <button
              type="submit"
              disabled={isSearching || !query.trim()}
              aria-label={t('promptHistorySearch.searchBtn')}
              className="px-5 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold text-xs rounded-xl transition-all focus-ring active:scale-95 flex items-center gap-2 shrink-0 shadow-lg shadow-indigo-950/50"
            >
              <Search className="w-4 h-4" />
              <span>{isSearching ? t('promptHistorySearch.searching') : t('promptHistorySearch.searchBtn')}</span>
            </button>
          </form>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-3 bg-slate-950/60 select-text" tabIndex={0}>
          {isSearching && (
            <div className="space-y-3" aria-label={t('common.loading')}>
              {[1, 2, 3].map((i) => (
                <div key={i} className="p-4 bg-slate-900/60 rounded-xl border border-slate-800 space-y-3 skeleton-pulse">
                  <div className="flex justify-between">
                    <div className="h-3.5 bg-slate-800 rounded w-1/4" />
                    <div className="h-3.5 bg-slate-800 rounded w-16" />
                  </div>
                  <div className="h-3 bg-slate-800 rounded w-full" />
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="p-4 bg-rose-950/40 border border-rose-800/80 rounded-xl text-xs text-rose-300 flex items-start gap-3" role="alert">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">{t('common.error')}</div>
                <p className="mt-1 font-mono text-[11px] text-rose-400/90">{error}</p>
              </div>
            </div>
          )}

          {!isSearching && !error && !hasSearched && (
            <div className="h-full flex flex-col items-center justify-center text-center p-12 space-y-3 text-slate-400">
              <FolderGit2 className="w-12 h-12 text-indigo-500/30" />
              <div className="font-semibold text-slate-400 text-sm">{t('promptHistorySearch.modalTitle')}</div>
              <p className="text-xs max-w-md text-slate-400 leading-relaxed">{t('promptHistorySearch.modalSubtitle')}</p>
            </div>
          )}

          {!isSearching && !error && hasSearched && results.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center p-12 space-y-2 text-slate-400">
              <Search className="w-10 h-10 text-slate-600" />
              <div className="font-semibold text-slate-400 text-sm">{t('promptHistorySearch.noResults')}</div>
              <p className="text-xs max-w-md text-slate-400">{t('promptHistorySearch.noResultsHint')}</p>
            </div>
          )}

          {!isSearching && results.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400 pb-1">
                <span className="font-bold uppercase tracking-wider text-[11px] text-indigo-400 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> {t('promptHistorySearch.resultsFound', { count: results.length })}
                </span>
              </div>

              {results.map((r, idx) => {
                const outcome = OUTCOME_STYLES[r.outcome] || OUTCOME_STYLES.unknown
                const OutcomeIcon = outcome.icon
                const projectName = resolveProjectName(projects, r.project_path)

                return (
                  <div
                    key={r.id}
                    className="p-4 bg-slate-900/80 rounded-xl border border-slate-800 hover:border-indigo-500/40 transition-all space-y-2.5 shadow-md"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 truncate min-w-0">
                        <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-indigo-300 font-mono text-[10px] font-bold shrink-0">
                          #{idx + 1}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300 text-[10px] font-semibold truncate" title={r.project_path}>
                          {projectName}
                        </span>
                        <OutcomeIcon className={`w-3.5 h-3.5 shrink-0 ${outcome.className}`} aria-label={t(outcome.labelKey)} />
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2.5 py-0.5 rounded-full bg-indigo-950 border border-indigo-800/80 text-indigo-300 font-mono font-bold text-[10px]">
                          {t('promptHistorySearch.score')}: {(r.score * 100).toFixed(1)}%
                        </span>
                        <button
                          type="button"
                          onClick={() => handleJump(r.project_path, r.session_id)}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-indigo-900/60 border border-slate-700 hover:border-indigo-600 text-slate-300 hover:text-indigo-300 text-[10px] font-bold rounded-lg transition-all focus-ring active:scale-95 flex items-center gap-1"
                        >
                          {t('promptHistorySearch.jumpBtn')} <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    <div className="p-3 bg-slate-950 rounded-lg border border-slate-800/80 text-slate-300 text-xs font-sans whitespace-pre-wrap leading-relaxed">
                      {r.prompt}
                    </div>

                    <div className="text-[10px] text-slate-500 font-mono">{formatDateTime(r.completed_at || r.started_at)}</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end text-xs shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-medium rounded-xl transition-all focus-ring active:scale-95"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
