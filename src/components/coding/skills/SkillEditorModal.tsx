import React, { useState, useEffect } from 'react'
import { X, Save, Sparkles, FileText, AlertCircle } from 'lucide-react'
import { SkillDefinition, SkillSaveInput } from '../../../types'
import { useTranslation } from '../../../i18n'

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
  const { t } = useTranslation()
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
      setContent('# Skill Guidelines\n\n## 1. Directives\n- Enter instructions and rules for the AI Agent here.')
    }
    setValidationError(null)
  }, [initialSkill, isOpen])

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setValidationError('Skill name is required')
      return
    }
    if (!content.trim()) {
      setValidationError('Guidelines markdown content cannot be empty')
      return
    }

    const triggersList = triggers
      .split(',')
      .map((tr) => tr.trim().toLowerCase())
      .filter(Boolean)
    const tagsList = tags
      .split(',')
      .map((tg) => tg.trim().toLowerCase())
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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="skill-editor-modal-title"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 id="skill-editor-modal-title" className="text-base font-bold text-slate-100">
                {initialSkill ? `${t('common.edit')} Skill: ${initialSkill.name}` : t('skills.createSkillBtn')}
              </h2>
              <p className="text-xs text-slate-400">
                {t('skills.hubSubtitle')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
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
              <label htmlFor="skill-name-input" className="block text-xs font-semibold text-slate-300 mb-1">
                {t('skills.skillName')} *
              </label>
              <input
                id="skill-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('skills.skillNamePlaceholder')}
                disabled={!!initialSkill}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus-ring disabled:opacity-60 font-mono placeholder:text-slate-400"
              />
            </div>

            <div>
              <label htmlFor="skill-version-input" className="block text-xs font-semibold text-slate-300 mb-1">
                {t('common.version')}
              </label>
              <input
                id="skill-version-input"
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder={t('skills.skillVersionPlaceholder')}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus-ring font-mono placeholder:text-slate-400"
              />
            </div>
          </div>

          <div>
            <label htmlFor="skill-desc-input" className="block text-xs font-semibold text-slate-300 mb-1">
              {t('skills.skillDescription')}
            </label>
            <input
              id="skill-desc-input"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('skills.skillDescPlaceholder')}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus-ring placeholder:text-slate-400"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="skill-triggers-input" className="block text-xs font-semibold text-slate-300 mb-1">
                {t('skills.skillTriggers')}
              </label>
              <input
                id="skill-triggers-input"
                type="text"
                value={triggers}
                onChange={(e) => setTriggers(e.target.value)}
                placeholder={t('skills.skillTriggersPlaceholder')}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus-ring font-mono placeholder:text-slate-400"
              />
            </div>

            <div>
              <label htmlFor="skill-tags-input" className="block text-xs font-semibold text-slate-300 mb-1">
                Tags
              </label>
              <input
                id="skill-tags-input"
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder={t('skills.skillTagsPlaceholder')}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus-ring font-mono placeholder:text-slate-400"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="skill-content-textarea" className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-cyan-400" /> {t('skills.skillContent')} *
              </label>
              <span className="text-[11px] text-slate-400 font-mono">SKILL.md</span>
            </div>
            <textarea
              id="skill-content-textarea"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              placeholder={t('skills.skillGuidelinesPlaceholder')}
              className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 font-mono focus-ring leading-relaxed resize-y placeholder:text-slate-400"
            />
          </div>

          {/* Footer Actions */}
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
              <Save className="w-4 h-4" /> {t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
