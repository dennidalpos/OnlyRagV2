import React, { useState } from 'react'
import { X, Plus, Globe, AlertCircle } from 'lucide-react'
import { CustomHubInput, HubSourceType } from '../../../types'
import { useTranslation } from '../../../i18n'

interface AddCustomHubModalProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (input: CustomHubInput) => Promise<void>
  isLoading: boolean
}

export const AddCustomHubModal: React.FC<AddCustomHubModalProps> = ({
  isOpen,
  onClose,
  onAdd,
  isLoading,
}) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [type, setType] = useState<HubSourceType>('json-catalog')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  React.useEffect(() => {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Hub name is required')
      return
    }
    if (!url.trim()) {
      setError('Hub URL is required')
      return
    }

    setError(null)
    await onAdd({
      name: name.trim(),
      url: url.trim(),
      type,
      description: description.trim() || undefined,
    })
    setName('')
    setUrl('')
    setDescription('')
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-custom-hub-title"
      className="fixed inset-0 z-[65] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h2 id="add-custom-hub-title" className="text-base font-bold text-slate-100">{t('skills.addCustomHubTitle')}</h2>
              <p className="text-xs text-slate-400">{t('skills.hubSubtitle')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all focus-ring"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div role="alert" className="px-6 py-2 bg-rose-500/10 border-b border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label htmlFor="hub-name-input" className="block text-xs font-semibold text-slate-300 mb-1">
              {t('skills.hubName')} *
            </label>
            <input
              id="hub-name-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('skills.customHubNamePlaceholder')}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus-ring placeholder:text-slate-400"
            />
          </div>

          <div>
            <label htmlFor="hub-url-input" className="block text-xs font-semibold text-slate-300 mb-1">
              {t('skills.hubUrl')} *
            </label>
            <input
              id="hub-url-input"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('skills.customHubUrlPlaceholder')}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus-ring font-mono placeholder:text-slate-400"
            />
          </div>

          <div>
            <label htmlFor="hub-type-select" className="block text-xs font-semibold text-slate-300 mb-1">
              {t('skills.hubType')}
            </label>
            <select
              id="hub-type-select"
              value={type}
              onChange={(e) => setType(e.target.value as HubSourceType)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus-ring"
            >
              <option value="json-catalog">JSON Catalog (hub.json / API)</option>
              <option value="github-repo">GitHub Repo / SKILL.md Raw</option>
            </select>
          </div>

          <div>
            <label htmlFor="hub-desc-input" className="block text-xs font-semibold text-slate-300 mb-1">
              {t('skills.skillDescription')}
            </label>
            <input
              id="hub-desc-input"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('skills.customHubDescPlaceholder')}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus-ring placeholder:text-slate-400"
            />
          </div>

          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-semibold rounded-xl transition-all"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 focus-ring"
            >
              <Plus className="w-4 h-4" /> {t('skills.addCustomHubTitle')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
