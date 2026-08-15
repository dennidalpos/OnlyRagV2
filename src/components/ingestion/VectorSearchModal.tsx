import React, { useState, useEffect } from 'react'
import { Search, X, AlertTriangle, Sparkles, Copy, Check, SlidersHorizontal, Database } from 'lucide-react'
import { apiService } from '../../services/api'
import { VectorSearchResult } from '../../types'
import { useTranslation } from '../../i18n'

interface VectorSearchModalProps {
  isOpen: boolean
  onClose: () => void
  embeddingModel?: string
}

export const VectorSearchModal: React.FC<VectorSearchModalProps> = ({
  isOpen,
  onClose,
  embeddingModel = 'nomic-embed-text',
}) => {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [topK, setTopK] = useState<number>(5)
  const [results, setResults] = useState<VectorSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleSearch = async () => {
    if (!query.trim()) return
    setIsSearching(true)
    setError(null)
    try {
      const res = await apiService.searchVectorDb(query.trim(), topK, embeddingModel)
      setResults(res || [])
      setHasSearched(true)
    } catch (err: any) {
      setError(err?.message || t('common.error'))
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }

  const handleCopyChunk = (text: string, index: number) => {
    navigator.clipboard.writeText(text)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="vector-search-modal-title"
      className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl flex flex-col shadow-2xl overflow-hidden max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
              <Database className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 id="vector-search-modal-title" className="text-base font-bold text-slate-100 flex items-center gap-2">
                {t('vectorSearch.modalTitle')}
              </h2>
              <p className="text-xs text-slate-400">
                {t('vectorSearch.modalSubtitle')}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-2 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-xl transition-colors focus-ring active:scale-95"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Toolbar */}
        <div className="p-5 border-b border-slate-800 bg-slate-950/40 space-y-3 shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSearch()
            }}
            className="flex items-center gap-3"
          >
            <div className="relative flex-1">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
                aria-label={t('vectorSearch.queryPlaceholder')}
                placeholder={t('vectorSearch.queryPlaceholder')}
                className="w-full bg-slate-950 border border-slate-800 focus-within:border-cyan-500 rounded-xl px-4 py-3 text-xs text-slate-100 outline-none focus-ring font-mono placeholder:text-slate-400 leading-relaxed shadow-inner"
              />
            </div>

            <button
              type="submit"
              disabled={isSearching || !query.trim()}
              aria-label={t('vectorSearch.searchBtn')}
              className="px-5 py-3 bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold text-xs rounded-xl transition-all focus-ring active:scale-95 flex items-center gap-2 shrink-0 shadow-lg shadow-cyan-950/50"
            >
              <Search className="w-4 h-4" />
              <span>{isSearching ? t('vectorSearch.searching') : t('vectorSearch.searchBtn')}</span>
            </button>
          </form>

          {/* Model & Top-K Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-400 flex items-center gap-1.5 font-medium">
                <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" /> {t('vectorSearch.topKResults')}:
              </span>
              <div className="flex items-center bg-slate-950 rounded-lg border border-slate-800 p-0.5" role="group" aria-label={t('vectorSearch.topKResults')}>
                {[3, 5, 10, 20].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTopK(k)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold transition-all ${
                      topK === k ? 'bg-cyan-950 text-cyan-300 border border-cyan-800 shadow-sm' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">{t('settings.embeddingTier')}:</span>
              <span className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-cyan-300 font-mono text-[11px] font-bold">
                {embeddingModel}
              </span>
            </div>
          </div>
        </div>

        {/* Results Stream Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-950/60 select-text" tabIndex={0} aria-label={t('vectorSearch.resultsFound', { count: results.length })}>
          {isSearching && (
            <div className="space-y-3" aria-label={t('common.loading')}>
              {[1, 2, 3].map((i) => (
                <div key={i} className="p-4 bg-slate-900/60 rounded-xl border border-slate-800 space-y-3 skeleton-pulse">
                  <div className="flex justify-between">
                    <div className="h-3.5 bg-slate-800 rounded w-1/4" />
                    <div className="h-3.5 bg-slate-800 rounded w-16" />
                  </div>
                  <div className="h-3 bg-slate-800 rounded w-full" />
                  <div className="h-3 bg-slate-800 rounded w-4/5" />
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
            <div className="h-full flex flex-col items-center justify-center text-center p-12 space-y-3 text-slate-500">
              <Database className="w-12 h-12 text-cyan-500/30" />
              <div className="font-semibold text-slate-400 text-sm">{t('vectorSearch.modalTitle')}</div>
              <p className="text-xs max-w-md text-slate-500 leading-relaxed">
                {t('vectorSearch.modalSubtitle')}
              </p>
            </div>
          )}

          {!isSearching && !error && hasSearched && results.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center p-12 space-y-2 text-slate-500">
              <Search className="w-10 h-10 text-slate-600" />
              <div className="font-semibold text-slate-400 text-sm">{t('vectorSearch.noResults')}</div>
              <p className="text-xs max-w-md text-slate-500">
                {t('vectorSearch.noResults')}
              </p>
            </div>
          )}

          {!isSearching && results.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400 pb-1">
                <span className="font-bold uppercase tracking-wider text-[11px] text-cyan-400 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> {t('vectorSearch.resultsFound', { count: results.length })}
                </span>
                <span className="font-mono text-[10px] text-slate-500">{t('vectorSearch.score')}</span>
              </div>

              {results.map((r: any, idx: number) => {
                const score = r.score !== undefined ? Number(r.score) : 0
                return (
                  <div
                    key={idx}
                    className="p-4 bg-slate-900/80 rounded-xl border border-slate-800 hover:border-cyan-500/40 transition-all space-y-2.5 shadow-md"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 truncate">
                        <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-cyan-300 font-mono text-[10px] font-bold">
                          #{idx + 1}
                        </span>
                        <span className="font-bold text-slate-200 truncate">{r.doc_name || t('vectorSearch.docName')}</span>
                        {r.chunk_id && (
                          <span className="text-[10px] text-slate-500 font-mono hidden md:inline">
                            [{r.chunk_id}]
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2.5 py-0.5 rounded-full bg-cyan-950 border border-cyan-800/80 text-cyan-300 font-mono font-bold text-[10px]">
                          {t('vectorSearch.score')}: {score.toFixed(4)}
                        </span>

                        <button
                          onClick={() => handleCopyChunk(r.text, idx)}
                          aria-label={t('common.copy')}
                          className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors focus-ring"
                          title={t('common.copy')}
                        >
                          {copiedIndex === idx ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    <div className="p-3 bg-slate-950 rounded-lg border border-slate-800/80 text-slate-300 text-xs font-sans whitespace-pre-wrap leading-relaxed">
                      {r.text}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs shrink-0">
          <span className="text-slate-500 font-mono text-[11px]">
            LanceDB Embedded Vector Database • Hybrid Search Engine
          </span>
          <button
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
