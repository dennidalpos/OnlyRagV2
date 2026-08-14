import React, { useState, useEffect } from 'react'
import { X, Save, Sparkles, FileText, AlertCircle } from 'lucide-react'
import { SkillDefinition, SkillSaveInput } from '../../../types'

interface SkillEditorModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (input: SkillSaveInput) => Promise<void>
  initialSkill?: SkillDefinition | null
  isLoading: boolean
}

export const SkillEditorModal: React.FC<SkillEditorModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialSkill,
  isLoading,
}) => {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [version, setVersion] = useState('1.0.0')
  const [author, setAuthor] = useState('Local')
  const [triggers, setTriggers] = useState('')
  const [tags, setTags] = useState('')
  const [content, setContent] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (initialSkill) {
      setName(initialSkill.name)
      setDescription(initialSkill.description)
      setVersion(initialSkill.version || '1.0.0')
      setAuthor(initialSkill.author || 'Local')
      setTriggers((initialSkill.triggers || []).join(', '))
      setTags((initialSkill.tags || []).join(', '))
      setContent(initialSkill.content || '')
    } else {
      setName('')
      setDescription('')
      setVersion('1.0.0')
      setAuthor('Local')
      setTriggers('')
      setTags('custom, coding')
      setContent('# Linee Guida Personalizzate\n\n## 1. Regole Operative\n- Descrivi qui le istruzioni e i pattern che l\'AI Agent deve seguire.')
    }
    setValidationError(null)
  }, [initialSkill, isOpen])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setValidationError('Il nome della skill è obbligatorio')
      return
    }
    if (!content.trim()) {
      setValidationError('Il contenuto delle linee guida markdown non può essere vuoto')
      return
    }

    const triggersList = triggers
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
    const tagsList = tags
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)

    const payload: SkillSaveInput = {
      name: name.trim(),
      description: description.trim() || `Skill ${name.trim()}`,
      version: version.trim() || '1.0.0',
      author: author.trim() || 'Local',
      triggers: triggersList.length > 0 ? triggersList : [name.trim().toLowerCase()],
      tags: tagsList.length > 0 ? tagsList : ['custom'],
      content: content.trim(),
      originHub: initialSkill?.originHub,
      originHubId: initialSkill?.originHubId,
      originChecksum: initialSkill?.originChecksum,
      isModified: initialSkill?.originHub ? true : undefined,
    }

    await onSave(payload)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">
                {initialSkill ? `Modifica Skill: ${initialSkill.name}` : 'Crea Nuova Skill Personalizzata'}
              </h2>
              <p className="text-xs text-slate-400">
                {initialSkill?.originHub
                  ? 'Attenzione: la modifica segnerà questa skill come personalizzata/modificata rispetto all\'originale del sito.'
                  : 'Definisci linee guida `SKILL.md` locali che verranno salvate nel workspace o AppData.'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Chiudi editor"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {validationError && (
          <div className="px-6 py-2 bg-rose-500/10 border-b border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{validationError}</span>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Nome Skill (slug univoco) *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="es. my-clean-architecture"
                disabled={!!initialSkill}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-cyan-500 disabled:opacity-60 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Versione
              </label>
              <input
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="1.0.0"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Descrizione
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descrizione sintetica dello scopo della skill"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Triggers (separati da virgola)
              </label>
              <input
                type="text"
                value={triggers}
                onChange={(e) => setTriggers(e.target.value)}
                placeholder="react, clean-code, pydantic"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Tag (separati da virgola)
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="frontend, backend, security"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-cyan-400" /> Linee Guida Markdown *
              </label>
              <span className="text-[11px] text-slate-500">Istruzioni operative per l'AI Agent</span>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              placeholder="# Titolo Skill&#10;&#10;## 1. Regole&#10;- Regola 1"
              className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500 leading-relaxed resize-y"
            />
          </div>

          {/* Footer Actions */}
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
              <Save className="w-4 h-4" /> {initialSkill ? 'Salva Modifiche' : 'Crea Skill'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
