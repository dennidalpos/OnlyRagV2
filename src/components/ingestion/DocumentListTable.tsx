import React, { useState, useMemo } from 'react'
import { FileText, Trash2, Check, X, Search } from 'lucide-react'
import { IngestedDocument } from '../../types'
import { useTranslation } from '../../i18n'

interface DocumentListTableProps {
  documents: IngestedDocument[]
  selectedDoc: IngestedDocument | null
  onSelectDoc: (doc: IngestedDocument) => void
  onDeleteDoc: (docId: string, filename: string) => void
}

export const DocumentListTable: React.FC<DocumentListTableProps> = ({
  documents,
  selectedDoc,
  onSelectDoc,
  onDeleteDoc,
}) => {
  const { t } = useTranslation()
  const [searchFilter, setSearchFilter] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const filteredDocs = useMemo(() => {
    if (!searchFilter.trim()) return documents
    const q = searchFilter.toLowerCase().trim()
    return documents.filter((doc) => doc.filename.toLowerCase().includes(q))
  }, [documents, searchFilter])

  return (
    <div className="space-y-2 flex-1 flex flex-col min-h-0">
      {/* Search / Filter bar for documents */}
      {documents.length > 2 && (
        <div className="relative shrink-0">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder={t('ingestion.searchPlaceholder')}
            aria-label={t('ingestion.searchPlaceholder')}
            className="w-full bg-slate-950/80 border border-slate-800 rounded-xl pl-8 pr-7 py-1.5 text-xs text-slate-200 placeholder:text-slate-400 outline-none focus-ring"
          />
          {searchFilter && (
            <button
              type="button"
              onClick={() => setSearchFilter('')}
              aria-label={t('common.clear')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-300 rounded"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      <div className="space-y-1.5 flex-1 overflow-y-auto pr-1" role="list" aria-label={t('ingestion.indexedDocuments')}>
        {documents.length === 0 ? (
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-center text-xs text-slate-400 italic">
            {t('ingestion.noDocuments')}
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-center text-xs text-slate-400 italic">
            {t('common.none')}
          </div>
        ) : (
          filteredDocs.map((doc) => {
            const isSelected = selectedDoc?.id === doc.id
            return (
              <div
                key={doc.id}
                role="listitem"
                className={`p-2 rounded-xl border flex items-center justify-between transition-all text-xs ${
                  isSelected
                    ? 'bg-cyan-950/40 border-cyan-500/60 text-cyan-200 shadow-sm'
                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 text-slate-300'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectDoc(doc)}
                  aria-pressed={isSelected}
                  aria-label={`${doc.filename} (${isSelected ? t('common.active') : t('common.none')})`}
                  className="flex items-center gap-2.5 truncate flex-1 text-left focus-ring rounded-lg p-1 transition-colors"
                >
                  <FileText className={`w-4 h-4 shrink-0 ${isSelected ? 'text-cyan-400' : 'text-slate-400'}`} />
                  <div className="truncate min-w-0">
                    <div className="font-semibold text-slate-200 truncate">{doc.filename}</div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      {doc.numPages > 0 ? `${doc.numPages} ${t('ingestion.pages')}` : ''} • {doc.numChunks} {t('ingestion.chunks')} • {(doc.fileSize / 1024).toFixed(0)} KB
                    </div>
                  </div>
                </button>

                <div className="flex items-center gap-1 shrink-0 ml-1.5">
                  {deletingId === doc.id ? (
                    <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                      <button
                        type="button"
                        onClick={() => {
                          onDeleteDoc(doc.id, doc.filename)
                          setDeletingId(null)
                        }}
                        title={t('common.confirm')}
                        aria-label={t('common.confirm')}
                        className="p-1 bg-rose-600 hover:bg-rose-500 text-white rounded transition-colors focus-ring active:scale-95"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingId(null)}
                        title={t('common.cancel')}
                        aria-label={t('common.cancel')}
                        className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors focus-ring"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDeletingId(doc.id)}
                      aria-label={`${t('common.delete')} ${doc.filename}`}
                      className="p-1.5 hover:bg-rose-950/80 rounded-lg text-slate-400 hover:text-rose-400 transition-colors focus-ring"
                      title={t('common.delete')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
