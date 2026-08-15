import React, { useState } from 'react'
import {
  CheckCircle,
  Trash2,
  Edit3,
  RotateCcw,
  Plus,
  Layers,
  Sparkles,
  AlertTriangle,
  Globe,
  User,
  Search,
} from 'lucide-react'
import { SkillDefinition } from '../../../types'
import { useTranslation } from '../../../i18n'

interface InstalledSkillsListProps {
  skills: SkillDefinition[]
  onToggleActive: (skillId: string, currentActive: boolean) => void
  onEditSkill: (skill: SkillDefinition) => void
  onResetSkill: (skillId: string) => void
  onDeleteSkill: (skillId: string) => void
  onOpenCreateModal: () => void
  onSwitchToHub: () => void
}

export const InstalledSkillsList: React.FC<InstalledSkillsListProps> = ({
  skills,
  onToggleActive,
  onEditSkill,
  onResetSkill,
  onDeleteSkill,
  onOpenCreateModal,
  onSwitchToHub,
}) => {
  const { t } = useTranslation()
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [originFilter, setOriginFilter] = useState<'all' | 'hub_original' | 'hub_modified' | 'local_custom'>('all')

  const filteredSkills = skills.filter((skill) => {
    const q = searchQuery.toLowerCase().trim()
    const matchesSearch =
      !q ||
      skill.name.toLowerCase().includes(q) ||
      skill.description.toLowerCase().includes(q) ||
      skill.triggers.some((tr) => tr.toLowerCase().includes(q)) ||
      skill.tags.some((tg) => tg.toLowerCase().includes(q))

    const matchesOrigin = originFilter === 'all' || skill.originType === originFilter
    return matchesSearch && matchesOrigin
  })

  if (skills.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500 space-y-4">
        <Layers className="w-10 h-10 mx-auto text-slate-600" />
        <div>
          <p className="text-sm font-medium text-slate-300">{t('skills.noSkills')}</p>
          <p className="text-xs text-slate-500">{t('skills.hubSubtitle')}</p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={onOpenCreateModal}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs rounded-xl transition-all inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5 text-cyan-400" /> {t('skills.createSkillBtn')}
          </button>
          <button
            onClick={onSwitchToHub}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs rounded-xl transition-all inline-flex items-center gap-1.5"
          >
            <Globe className="w-3.5 h-3.5" /> {t('skills.marketplaceTab')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('skills.searchPlaceholder')}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            {[
              { id: 'all', label: t('common.all') },
              { id: 'hub_original', label: 'Hub' },
              { id: 'hub_modified', label: 'Mod' },
              { id: 'local_custom', label: 'Local' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setOriginFilter(f.id as any)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                  originFilter === f.id
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <button
            onClick={onOpenCreateModal}
            className="px-3 py-1.5 bg-cyan-600/20 border border-cyan-500/30 hover:bg-cyan-600/30 text-cyan-300 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" /> {t('skills.createSkillBtn')}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {filteredSkills.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-xs">
            {t('common.none')}
          </div>
        ) : (
          filteredSkills.map((skill) => (
          <div
            key={skill.id}
            className="p-4 rounded-xl border border-slate-800 bg-slate-950/40 hover:border-slate-700 transition-all space-y-3"
          >
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-200">{skill.name}</h3>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                    v{skill.version || '1.0.0'}
                  </span>

                  {/* Provenance Badges */}
                  {skill.originType === 'hub_original' && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-medium flex items-center gap-1">
                      <Globe className="w-3 h-3" /> {t('skills.originalHubBadge')} ({skill.originHub || 'Hub'})
                    </span>
                  )}
                  {skill.originType === 'hub_modified' && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 font-medium flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> {t('skills.modifiedBadge')}
                    </span>
                  )}
                  {skill.originType === 'local_custom' && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 font-medium flex items-center gap-1">
                      <User className="w-3 h-3" /> {t('skills.customBadge')}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400">{skill.description}</p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1.5 self-end sm:self-start shrink-0">
                <button
                  type="button"
                  onClick={() => onToggleActive(skill.id, skill.isActive)}
                  aria-label={skill.isActive ? `${t('common.active')}: ${skill.name}` : `Auto: ${skill.name}`}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 focus-ring ${
                    skill.isActive
                      ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                  title={skill.isActive ? t('common.active') : 'Auto'}
                >
                  <CheckCircle className="w-3 h-3" />
                  {skill.isActive ? t('common.active') : 'Auto'}
                </button>

                <button
                  type="button"
                  onClick={() => onEditSkill(skill)}
                  aria-label={`${t('common.edit')} ${skill.name}`}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-cyan-300 hover:bg-slate-700 transition-all focus-ring"
                  title={t('common.edit')}
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>

                {skill.originType === 'hub_modified' && (
                  <button
                    type="button"
                    onClick={() => onResetSkill(skill.id)}
                    aria-label={`${t('skills.resetOriginal')} ${skill.name}`}
                    className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-all focus-ring"
                    title={t('skills.resetOriginal')}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onDeleteSkill(skill.id)}
                  aria-label={`${t('common.delete')} ${skill.name}`}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all focus-ring"
                  title={t('common.delete')}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Triggers and Tags */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {skill.triggers.map((tr) => (
                <span key={tr} className="text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
                  trigger: {tr}
                </span>
              ))}
            </div>

            {/* Expandable Preview */}
            <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between">
              <button
                onClick={() => setExpandedSkillId(expandedSkillId === skill.id ? null : skill.id)}
                className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1"
              >
                {expandedSkillId === skill.id ? t('common.close') : t('common.viewDetails')}
              </button>
              <span className="text-[10px] text-slate-500 font-mono truncate max-w-xs">{skill.filePath}</span>
            </div>

            {expandedSkillId === skill.id && (
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300 font-mono overflow-x-auto max-h-48 whitespace-pre-wrap">
                {skill.content}
              </div>
            )}
          </div>
        )))}
      </div>
    </div>
  )
}
