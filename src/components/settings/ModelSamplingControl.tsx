import React from 'react'
import type { AppSettings, OllamaSamplingOverrides } from '../../types'
import { SAMPLING_LIMITS, pickSamplingOverrides } from '../../../shared/domain/agent/ollamaSamplingOptions'
import { useTranslation } from '../../i18n'

interface ModelSamplingControlProps {
  modelName: string
  settings: AppSettings
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void
}

type SamplingKey = keyof OllamaSamplingOverrides

const SAMPLING_KEYS = Object.keys(SAMPLING_LIMITS) as SamplingKey[]

/**
 * Per-model sampling overrides for the Coding Agent. An empty field keeps the Modelfile default, which
 * is what the agent sends when nothing is set; a value outside the accepted range is not saved.
 */
export const ModelSamplingControl: React.FC<ModelSamplingControlProps> = ({ modelName, settings, onUpdateSettings }) => {
  const { t } = useTranslation()
  const stored = pickSamplingOverrides(settings.modelSamplingOverrides?.[modelName])
  const [drafts, setDrafts] = React.useState<Partial<Record<SamplingKey, string>>>({})
  const overriddenCount = Object.keys(stored).length

  const save = (next: OllamaSamplingOverrides) => {
    const modelSamplingOverrides = { ...(settings.modelSamplingOverrides || {}) }
    if (Object.keys(next).length > 0) modelSamplingOverrides[modelName] = next
    else delete modelSamplingOverrides[modelName]
    onUpdateSettings({ modelSamplingOverrides })
  }

  const commit = (key: SamplingKey) => {
    const draft = drafts[key]
    if (draft === undefined) return
    const next: OllamaSamplingOverrides = { ...stored }
    if (draft.trim() === '') delete next[key]
    else {
      const valid = pickSamplingOverrides({ [key]: Number(draft.replace(',', '.')) })[key]
      // An invalid draft stays in the field, marked, until the user corrects or clears it.
      if (valid === undefined) return
      next[key] = valid
    }
    setDrafts(({ [key]: _committed, ...rest }) => rest)
    save(next)
  }

  return (
    <details className="rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2 text-[10px] text-slate-400">
      <summary className="cursor-pointer font-semibold text-slate-200">
        {t('settings.samplingLabel')}
        <span className="ml-1 font-normal text-slate-400">
          {overriddenCount > 0 ? t('settings.samplingOverridden').replace('{count}', String(overriddenCount)) : t('settings.samplingModelDefault')}
        </span>
      </summary>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {SAMPLING_KEYS.map((key) => {
          const limits = SAMPLING_LIMITS[key]
          const value = drafts[key] ?? (stored[key] === undefined ? '' : String(stored[key]))
          const invalid =
            drafts[key] !== undefined &&
            drafts[key]?.trim() !== '' &&
            pickSamplingOverrides({ [key]: Number(drafts[key]?.replace(',', '.')) })[key] === undefined
          return (
            <label key={key} className="space-y-0.5">
              <span className="block font-mono text-slate-300">{key}</span>
              <input
                type="text"
                inputMode="decimal"
                value={value}
                placeholder={t('settings.samplingDefaultPlaceholder')}
                aria-label={`${key} ${modelName}`}
                aria-invalid={invalid}
                title={`${limits.min} – ${limits.max}${limits.integer ? ' (int)' : ''}`}
                onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
                onBlur={() => commit(key)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commit(key)
                }}
                className={`w-full rounded bg-slate-900 px-1.5 py-0.5 font-mono text-slate-100 border ${invalid ? 'border-rose-500' : 'border-slate-700'}`}
              />
            </label>
          )
        })}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[9px] text-slate-500">{t('settings.samplingHint')}</span>
        {overriddenCount > 0 && (
          <button type="button" onClick={() => save({})} className="shrink-0 rounded px-1.5 py-0.5 bg-slate-700 text-slate-200">
            {t('settings.samplingReset')}
          </button>
        )}
      </div>
    </details>
  )
}
