import React, { useState, useRef, useEffect } from 'react'
import { Globe, Plus, HelpCircle, Trash2, Check, RefreshCw, ChevronDown, CheckCircle2, Shield, FolderGit2, Layers } from 'lucide-react'
import { SkillHubSource } from '../../../types'
import { useTranslation } from '../../../i18n'

interface SkillHubSourceSelectorProps {
  sources: SkillHubSource[]
  selectedSourceId: string
  onSelectSource: (sourceId: string) => void
  onOpenAddHubModal: () => void
  onOpenGuideModal: () => void
  onRemoveCustomSource: (sourceId: string) => void
  onRefresh: () => void
  isLoading: boolean
}

export const SkillHubSourceSelector: React.FC<SkillHubSourceSelectorProps> = ({
  sources,
  selectedSourceId,
  onSelectSource,
  onOpenAddHubModal,
  onOpenGuideModal,
  onRemoveCustomSource,
  onRefresh,
  isLoading,
}) => {
  const { t } = useTranslation()
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selectedSource = sources.find((s) => s.id === selectedSourceId) || sources[0]

  // Close dropdown on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsDropdownOpen(false)
      }
    }

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isDropdownOpen])

  const handleSelect = (sourceId: string) => {
    onSelectSource(sourceId)
    setIsDropdownOpen(false)
  }

  const getSourceIcon = (type?: string, isBuiltin?: boolean) => {
    if (isBuiltin) return <Shield className="w-3.5 h-3.5 text-emerald-400" />
    if (type === 'github-repo') return <FolderGit2 className="w-3.5 h-3.5 text-purple-400" />
    if (type === 'json-catalog') return <Layers className="w-3.5 h-3.5 text-amber-400" />
    return <Globe className="w-3.5 h-3.5 text-cyan-400" />
  }

  return (
    <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/80 space-y-3 shadow-md relative">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400">
            <Globe className="w-4 h-4" />
          </div>
          <div>
            <span className="text-xs font-bold text-slate-200">{t('skills.hubTitle')}:</span>
            <p className="text-[11px] text-slate-400">{t('skills.hubSubtitle')}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={onOpenGuideModal}
            className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-cyan-400 hover:bg-slate-800 text-xs font-medium transition-all flex items-center gap-1.5"
            title={t('common.info')}
          >
            <HelpCircle className="w-3.5 h-3.5" /> Guide
          </button>
          <button
            type="button"
            onClick={onOpenAddHubModal}
            className="px-2.5 py-1.5 rounded-lg bg-cyan-600/20 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-600/30 text-xs font-semibold transition-all flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> {t('skills.addCustomHubTitle')}
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 transition-all disabled:opacity-50"
            title={t('common.refresh')}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Custom Interactive Dropdown Menu */}
      <div className="relative" ref={dropdownRef}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsDropdownOpen((prev) => !prev)}
            aria-haspopup="listbox"
            aria-expanded={isDropdownOpen}
            className="flex-1 flex items-center justify-between px-3.5 py-2.5 bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded-xl text-xs text-slate-200 font-medium transition-all cursor-pointer shadow-sm text-left group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {getSourceIcon(selectedSource?.type, selectedSource?.isBuiltin)}
              <span className="font-semibold text-slate-100 truncate">
                {selectedSource ? selectedSource.name : t('skills.hubTitle')}
              </span>
              {selectedSource?.isBuiltin ? (
                <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-800 text-[10px] font-mono text-emerald-300">
                  Official
                </span>
              ) : (
                <span className="px-1.5 py-0.5 rounded bg-purple-950/80 border border-purple-800 text-[10px] font-mono text-purple-300">
                  {selectedSource?.type || 'Custom'}
                </span>
              )}
            </div>
            <ChevronDown
              className={`w-4 h-4 text-slate-400 group-hover:text-cyan-400 transition-transform duration-200 shrink-0 ml-2 ${
                isDropdownOpen ? 'rotate-180 text-cyan-400' : ''
              }`}
            />
          </button>

          {selectedSource && !selectedSource.isBuiltin && (
            <button
              type="button"
              onClick={() => onRemoveCustomSource(selectedSource.id)}
              className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 text-xs transition-all shrink-0"
              title={t('common.delete')}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Dropdown Menu Items Floating Overlay */}
        {isDropdownOpen && (
          <div
            role="listbox"
            className="absolute top-full left-0 right-0 mt-1.5 z-50 bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden max-h-72 overflow-y-auto divide-y divide-slate-800/60 backdrop-blur-md animate-in fade-in slide-in-from-top-1 duration-150"
          >
            {sources.map((s) => {
              const isSelected = s.id === selectedSourceId
              return (
                <div
                  key={s.id}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  onClick={() => handleSelect(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleSelect(s.id)
                    }
                  }}
                  className={`px-3.5 py-2.5 flex items-start justify-between gap-3 cursor-pointer transition-colors focus-ring ${
                    isSelected
                      ? 'bg-cyan-950/60 text-cyan-200'
                      : 'hover:bg-slate-800/80 text-slate-300'
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="mt-0.5 shrink-0">
                      {getSourceIcon(s.type, s.isBuiltin)}
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs text-slate-100">{s.name}</span>
                        {s.isBuiltin ? (
                          <span className="px-1.5 py-0.2 rounded bg-emerald-950 border border-emerald-800 text-[9px] font-mono text-emerald-400">
                            Official
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.2 rounded bg-purple-950 border border-purple-800 text-[9px] font-mono text-purple-300">
                            {s.type}
                          </span>
                        )}
                      </div>
                      {s.description && (
                        <p className="text-[11px] text-slate-400 line-clamp-1">{s.description}</p>
                      )}
                      <p className="text-[10px] font-mono text-slate-400 truncate">{s.url}</p>
                    </div>
                  </div>

                  {isSelected && (
                    <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-1" />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {selectedSource && (
        <div className="text-[11px] text-slate-400 flex items-center justify-between pt-0.5">
          <span className="truncate mr-2">{selectedSource.description}</span>
          <span className="font-mono text-slate-400 text-[10px] truncate max-w-xs shrink-0">{selectedSource.url}</span>
        </div>
      )}
    </div>
  )
}
