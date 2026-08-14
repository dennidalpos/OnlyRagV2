import React, { useState } from 'react'
import { X, Plus, Globe, AlertCircle } from 'lucide-react'
import { CustomHubInput, HubSourceType } from '../../../types'

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
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [type, setType] = useState<HubSourceType>('json-catalog')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Il nome dell\'Hub è obbligatorio')
      return
    }
    if (!url.trim()) {
      setError('L\'URL dell\'Hub è obbligatorio')
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
    <div className="fixed inset-0 z-[65] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">Aggiungi Hub Personalizzato</h2>
              <p className="text-xs text-slate-400">Collega un repository o endpoint remoto di skill</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Chiudi"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="px-6 py-2 bg-rose-500/10 border-b border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Nome Hub *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="es. Team AI Skills Hub"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              URL Endpoint / Repository *
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://raw.githubusercontent.com/.../hub.json"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Tipo Formato
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as HubSourceType)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="json-catalog">Catalogo JSON Remoto (hub.json / API)</option>
              <option value="github-repo">Repository GitHub / SKILL.md Raw</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Descrizione
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Breve descrizione del contenuto di questo hub"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-850 hover:bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl transition-all"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 focus-ring"
            >
              <Plus className="w-4 h-4" /> Aggiungi Hub
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
