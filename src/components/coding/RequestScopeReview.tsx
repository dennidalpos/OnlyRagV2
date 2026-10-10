import { useState } from 'react'
import { validateRequestLedger, type RequestCoverageLedger } from '../../../shared/domain/agent/requestCoverageLedger'
import { useTranslation } from '../../i18n'

export function RequestScopeReview({
  draft,
  onConfirm,
  onCancel,
}: {
  draft: RequestCoverageLedger
  onConfirm: (ledger: RequestCoverageLedger) => void
  onCancel?: () => void
}) {
  const { t } = useTranslation()
  const [ledger, setLedger] = useState(() => structuredClone(draft))
  const error = validateRequestLedger(ledger, draft.request)
  const update = (index: number, changes: Partial<RequestCoverageLedger['obligations'][number]>) =>
    setLedger((previous) => ({
      ...previous,
      obligations: previous.obligations.map((item, i) => (i === index ? { ...item, ...changes } : item)),
    }))
  const lines = draft.request.split(/\r?\n/)
  const fieldClass = 'w-full rounded bg-slate-950 border border-slate-700 p-2 text-xs text-slate-200'
  return (
    <section className="space-y-3" aria-label={t('requestScope.title')}>
      <h2 className="font-semibold text-cyan-300">{t('requestScope.title')}</h2>
      <p className="text-xs text-slate-400">{t('requestScope.description')}</p>
      {ledger.obligations.map((item, index) => (
        <fieldset key={item.id} className="space-y-2 rounded border border-slate-700 p-3">
          <legend className="text-xs text-slate-400">{index + 1}</legend>
          <blockquote className="text-xs whitespace-pre-wrap text-slate-300">{item.sourceLines.map((line) => lines[line - 1]).join('\n')}</blockquote>
          <label className="block text-xs">
            {t('requestScope.requirement')}
            <textarea className={fieldClass} value={item.requirement} onChange={(event) => update(index, { requirement: event.target.value })} />
          </label>
          <label className="block text-xs">
            {t('requestScope.subject')}
            <input className={fieldClass} value={item.subject} onChange={(event) => update(index, { subject: event.target.value })} />
          </label>
          <label className="block text-xs">
            {t('requestScope.scope')}
            <select
              className={fieldClass}
              value={item.scope}
              onChange={(event) =>
                update(index, {
                  scope: event.target.value as typeof item.scope,
                })
              }
            >
              <option value="global">{t('requestScope.global')}</option>
              <option value="local">{t('requestScope.local')}</option>
              <option value="context">{t('requestScope.context')}</option>
            </select>
          </label>
          <label className="block text-xs">
            {t('requestScope.targets')}
            <textarea
              className={fieldClass}
              value={item.targets.join('\n')}
              onChange={(event) =>
                update(index, {
                  targets: event.target.value ? event.target.value.split('\n') : [],
                })
              }
            />
          </label>
          <label className="block text-xs">
            <input type="checkbox" checked={item.closedInventory} onChange={(event) => update(index, { closedInventory: event.target.checked })} />{' '}
            {t('requestScope.closed')}
          </label>
          <label className="block text-xs">
            {t('requestScope.conditions')}
            <textarea
              className={fieldClass}
              value={item.conditions.join('\n')}
              onChange={(event) =>
                update(index, {
                  conditions: event.target.value ? event.target.value.split('\n') : [],
                })
              }
            />
          </label>
          <div className="flex gap-3 text-xs">
            <button
              type="button"
              onClick={() =>
                setLedger((previous) => ({
                  ...previous,
                  obligations: [...previous.obligations, { ...structuredClone(item), id: crypto.randomUUID() }],
                }))
              }
            >
              {t('requestScope.split')}
            </button>
            <button
              type="button"
              onClick={() =>
                setLedger((previous) => ({
                  ...previous,
                  obligations: previous.obligations.filter((entry) => entry.id !== item.id),
                }))
              }
            >
              {t('common.delete')}
            </button>
          </div>
        </fieldset>
      ))}
      {error && (
        <p role="alert" className="text-xs text-rose-300">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          disabled={Boolean(error)}
          onClick={() => onConfirm(structuredClone(ledger))}
          className="rounded bg-cyan-800 px-3 py-2 text-xs disabled:opacity-40"
        >
          {t('requestScope.confirm')}
        </button>
        <button type="button" onClick={onCancel} className="text-xs text-rose-300">
          {t('common.cancel')}
        </button>
      </div>
    </section>
  )
}
