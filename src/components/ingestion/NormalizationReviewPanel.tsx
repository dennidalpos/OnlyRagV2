import { useId } from 'react'
import { Download, X } from 'lucide-react'
import type { NormalizationReview } from '../../types'
import { useTranslation } from '../../i18n'

interface Props {
  review: NormalizationReview
  exporting: boolean
  onExport: () => void
  onDismiss: () => void
}

export function NormalizationReviewPanel({ review, exporting, onExport, onDismiss }: Props) {
  const { t } = useTranslation()
  const sourceId = useId()
  return (
    <section className="mx-4 mt-3 p-3 bg-amber-950/40 border border-amber-800/60 rounded-xl shrink-0" aria-label={t('ingestion.normalizationReviewTitle')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0" role="alert">
          <h2 className="text-sm font-semibold text-amber-200">{t('ingestion.normalizationReviewTitle')}</h2>
          <p className="text-xs text-slate-300 mt-1">{t('ingestion.normalizationReviewDescription')}</p>
        </div>
        <button type="button" onClick={onDismiss} aria-label={t('common.close')} className="p-1 text-amber-300 rounded focus-ring">
          <X className="w-4 h-4" />
        </button>
      </div>
      <ul className="text-xs text-amber-200 mt-2 max-h-20 overflow-auto list-disc pl-5">
        {review.issues.map((issue, index) => (
          <li key={`${issue.page}-${issue.reason}-${index}`}>
            {t('ingestion.normalizationReviewIssue', { page: issue.page, reason: t(`ingestion.normalizationReasons.${issue.reason}`) })}
          </li>
        ))}
      </ul>
      <details className="mt-2">
        <summary className="text-sm text-slate-200 cursor-pointer focus-ring">{t('ingestion.normalizationReviewOriginal')}</summary>
        <label className="sr-only" htmlFor={sourceId}>
          {t('ingestion.normalizationReviewOriginal')}
        </label>
        <textarea
          id={sourceId}
          readOnly
          value={review.originalMarkdown}
          rows={6}
          className="mt-2 w-full p-2 bg-slate-950 text-slate-200 text-xs font-mono rounded border border-slate-700"
        />
      </details>
      <button
        type="button"
        disabled={exporting}
        onClick={onExport}
        className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 text-xs text-amber-100 border border-amber-800 rounded focus-ring disabled:opacity-50"
      >
        <Download className="w-4 h-4" />
        {t('ingestion.normalizationReviewExport')}
      </button>
    </section>
  )
}
