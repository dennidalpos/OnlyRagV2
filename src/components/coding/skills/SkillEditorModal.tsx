import { Tooltip } from '../../common/Tooltip'
import React, { useState, useEffect, useRef, useId } from 'react'
import { Modal } from '../../common/Modal'
import { X, Save, Sparkles, FileText, AlertCircle, Plus } from 'lucide-react'
import { SkillDefinition, SkillSaveInput } from '../../../types'
import { useTranslation } from '../../../i18n'

interface SkillEditorModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (input: SkillSaveInput) => Promise<void>
  initialSkill?: SkillDefinition | null
  isLoading: boolean
  saveError?: string
}

type ListEntry = { id: number; value: string; original?: string }

function listEntries(values: readonly string[]): ListEntry[] {
  return values.map((value, id) => ({ id, value, original: value }))
}

function resolveList(entries: ListEntry[], fallback: string[]): string[] {
  const values = entries.flatMap(({ value, original }) => {
    if (value === original) return [value]
    const edited = value.trim()
    return edited ? [edited] : []
  })
  return values.length ? values : fallback
}

function SkillListFields({
  label,
  entries,
  onChange,
  disabled,
}: {
  label: string
  entries: ListEntry[]
  onChange: (entries: ListEntry[]) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const groupId = useId()
  const nextId = useRef(0)
  const focusId = useRef<number | null>(null)
  useEffect(() => {
    if (focusId.current === null) return
    document.getElementById(`${groupId}-${focusId.current}`)?.focus()
    focusId.current = null
  }, [entries, groupId])

  return (
    <fieldset disabled={disabled} aria-describedby="skill-list-hint" className="min-w-0 space-y-2">
      <legend className="text-xs font-semibold text-slate-300 mb-1">{label}</legend>
      {entries.map((entry, index) => {
        const entryLabel = `${label} ${index + 1}`
        return (
          <div key={entry.id} className="flex items-start gap-2">
            <textarea
              id={`${groupId}-${entry.id}`}
              rows={2}
              aria-label={entryLabel}
              value={entry.value}
              onChange={(event) => onChange(entries.map((item) => (item.id === entry.id ? { ...item, value: event.target.value } : item)))}
              className="min-w-0 flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus-ring font-mono resize-y"
            />
            <button
              type="button"
              aria-label={`${t('common.delete')} ${entryLabel}`}
              onClick={() => onChange(entries.filter((item) => item.id !== entry.id))}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-200 focus-ring"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )
      })}
      <button
        type="button"
        aria-label={`${t('skills.addListEntry')} · ${label}`}
        onClick={() => {
          const id = Math.max(nextId.current, (entries.at(-1)?.id ?? -1) + 1)
          nextId.current = id + 1
          focusId.current = id
          onChange([...entries, { id, value: '' }])
        }}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-cyan-300 hover:bg-slate-800 focus-ring"
      >
        <Plus className="w-3.5 h-3.5" aria-hidden="true" /> {t('skills.addListEntry')}
      </button>
    </fieldset>
  )
}

/** Untouched text keeps the stored value as is; only edited text is trimmed. */
function resolveText(text: string, initial: string | undefined, fallback: string): string {
  if (initial !== undefined && text === initial) return initial
  return text.trim() || fallback
}

export const SkillEditorModal: React.FC<SkillEditorModalProps> = ({ isOpen, onClose, onSave, initialSkill, isLoading, saveError }) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [version, setVersion] = useState('1.0.0')
  const [author, setAuthor] = useState('Local')
  const [triggers, setTriggers] = useState<ListEntry[]>([])
  const [tags, setTags] = useState<ListEntry[]>([])
  const [content, setContent] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (initialSkill) {
      setName(initialSkill.name)
      setDescription(initialSkill.description)
      setVersion(initialSkill.version || '1.0.0')
      setAuthor(initialSkill.author || 'Local')
      setTriggers(listEntries(initialSkill.triggers ?? []))
      setTags(listEntries(initialSkill.tags ?? []))
      setContent(initialSkill.content || '')
    } else {
      setName('')
      setDescription('')
      setVersion('1.0.0')
      setAuthor('Local')
      setTriggers([{ id: 0, value: '' }])
      setTags(listEntries(['custom', 'coding']))
      setContent('# Skill Guidelines\n\n## 1. Directives\n- Enter instructions and rules for the AI Agent here.')
    }
    setValidationError(null)
  }, [initialSkill, isOpen])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setValidationError(t('skills.nameRequired'))
      return
    }
    if (!content.trim()) {
      setValidationError(t('skills.contentRequired'))
      return
    }

    const contentChanged = content !== (initialSkill?.content || '')
    const payload: SkillSaveInput = {
      name: initialSkill ? initialSkill.name : name.trim(),
      description: resolveText(description, initialSkill?.description, `Skill ${name.trim()}`),
      version: resolveText(version, initialSkill?.version, '1.0.0'),
      author: resolveText(author, initialSkill?.author, 'Local'),
      triggers: resolveList(triggers, [name.trim().toLowerCase()]),
      tags: resolveList(tags, ['custom']),
      content,
      originHub: initialSkill?.originHub,
      originHubId: initialSkill?.originHubId,
      originChecksum: initialSkill?.originChecksum,
      isModified: initialSkill?.originHub ? (contentChanged ? true : initialSkill.isModified) : undefined,
    }

    await onSave(payload)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      labelledById="skill-editor-modal-title"
      layer="nested"
      panelClassName="relative max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 id="skill-editor-modal-title" className="text-base font-bold text-slate-100 inline-flex items-center gap-1.5">
              {initialSkill ? `${t('common.edit')} Skill: ${initialSkill.name}` : t('skills.createSkillBtn')}
              <Tooltip helpKey="skills_hubSubtitle" />
            </h2>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {(validationError || saveError) && (
        <div role="alert" className="px-6 py-2 bg-rose-500/10 border-b border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="min-w-0 break-words">{validationError || saveError}</span>
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
          <SkillListFields label={t('skills.skillTriggers')} entries={triggers} onChange={setTriggers} disabled={isLoading} />
          <SkillListFields label="Tags" entries={tags} onChange={setTags} disabled={isLoading} />
        </div>
        <p id="skill-list-hint" className="-mt-2 text-[11px] text-slate-400">
          {t('skills.listEntryHint')}
        </p>

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
    </Modal>
  )
}
