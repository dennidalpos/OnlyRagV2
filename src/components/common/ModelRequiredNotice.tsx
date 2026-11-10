import { useTranslation } from '../../i18n'

/** The selector remains available even when starting a generation is blocked. */
export function ModelRequiredNotice({ model, selectorId }: { model: string; selectorId: string }) {
  const { t } = useTranslation()
  if (model.trim()) return null
  return (
    <div role="status" className="min-w-0 shrink-0 px-4 py-2 text-xs text-amber-200 border-b border-amber-800 flex flex-wrap items-center gap-2">
      <span className="min-w-0 flex-1 break-words">{t('ux.modelRequired')}</span>
      <button
        type="button"
        className="rounded-lg border border-amber-700 px-2 py-1 focus-ring"
        onClick={() => {
          const selector = document.getElementById(selectorId)
          selector?.focus()
          selector?.click()
        }}
      >
        {t('ux.chooseModel')}
      </button>
    </div>
  )
}
