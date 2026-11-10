import type { DocumentCollectionState } from '../../hooks/useIngestedDocuments'
import { useTranslation } from '../../i18n'

export function DocumentCollectionStatus({ state, onRetry }: { state: DocumentCollectionState; onRetry: () => void }) {
  const { t } = useTranslation()
  if (!state.loadError && !state.isLoading) return null
  return (
    <div role="status" aria-live="polite" className="rounded-xl border border-slate-700 p-3 text-xs text-slate-300 flex flex-wrap items-center gap-2">
      <span>{t(state.loadError ? (state.isLoaded ? 'ux.documentsStale' : 'ux.documentsUnavailable') : 'ux.documentsLoading')}</span>
      {state.loadError && (
        <button
          type="button"
          disabled={state.isLoading}
          onClick={onRetry}
          className="rounded-lg border border-cyan-700 px-2 py-1 text-cyan-300 focus-ring disabled:opacity-50"
        >
          {t('ux.retry')}
        </button>
      )}
    </div>
  )
}
