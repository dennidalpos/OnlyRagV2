import React, { useState } from 'react'
import {
  Download,
  CheckCircle,
  Search,
  Code,
  Globe,
  Database,
  Shield,
  Layers,
  Cpu,
  ExternalLink,
  Plus,
  Loader2,
  FileText,
  FileCode,
  Copy,
  Check,
} from 'lucide-react'
import { HubSkillItem } from '../../../types'
import { apiService } from '../../../services/api'
import { useTranslation, TranslationKey } from '../../../i18n'

const CATEGORY_LABEL_KEYS: Record<string, TranslationKey> = {
  frontend: 'skills.category.frontend',
  backend: 'skills.category.backend',
  database: 'skills.category.database',
  security: 'skills.category.security',
  'ai-ml': 'skills.category.aiMl',
  architecture: 'skills.category.architecture',
}

interface MarketplaceSkillsListProps {
  hubSkills: HubSkillItem[]
  isLoading: boolean
  installingSkillId?: string | null
  onInstallSkill: (skillId: string) => void
  onInstallFromUrl: (url: string, customName?: string) => void
}

export const MarketplaceSkillsList: React.FC<MarketplaceSkillsListProps> = ({
  hubSkills,
  isLoading,
  installingSkillId,
  onInstallSkill,
  onInstallFromUrl,
}) => {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [urlInput, setUrlInput] = useState('')
  const [customNameInput, setCustomNameInput] = useState('')
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null)
  const [fetchedContents, setFetchedContents] = useState<Record<string, string>>({})
  const [loadingContentId, setLoadingContentId] = useState<string | null>(null)
  const [copiedSkillId, setCopiedSkillId] = useState<string | null>(null)

  const handleToggleExpand = async (hubItem: HubSkillItem) => {
    if (expandedSkillId === hubItem.id) {
      setExpandedSkillId(null)
      return
    }
    setExpandedSkillId(hubItem.id)
    if (!hubItem.rawContent && !fetchedContents[hubItem.id]) {
      setLoadingContentId(hubItem.id)
      try {
        const res = await apiService.getHubSkillContent(hubItem)
        if (res.success && res.content) {
          setFetchedContents((prev) => ({ ...prev, [hubItem.id]: res.content! }))
        }
      } catch {
        // Fallback handled in UI
      } finally {
        setLoadingContentId(null)
      }
    }
  }

  const handleCopyContent = (content: string, id: string) => {
    navigator.clipboard.writeText(content)
    setCopiedSkillId(id)
    setTimeout(() => setCopiedSkillId(null), 2000)
  }

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'frontend': return <Code className="w-3.5 h-3.5 text-cyan-400" />
      case 'backend': return <Globe className="w-3.5 h-3.5 text-emerald-400" />
      case 'database': return <Database className="w-3.5 h-3.5 text-amber-400" />
      case 'security': return <Shield className="w-3.5 h-3.5 text-rose-400" />
      case 'ai-ml': return <Cpu className="w-3.5 h-3.5 text-purple-400" />
      default: return <Layers className="w-3.5 h-3.5 text-indigo-400" />
    }
  }

  const filteredSkills = hubSkills.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.tags.some((tg) => tg.toLowerCase().includes(searchQuery.toLowerCase()))
    const matchesCategory = selectedCategory === 'all' || s.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!urlInput.trim()) return
    onInstallFromUrl(urlInput.trim(), customNameInput.trim() || undefined)
    setUrlInput('')
    setCustomNameInput('')
  }

  return (
    <div className="space-y-6">
      {/* Import from direct URL card */}
      <div className="p-4 rounded-xl border border-cyan-500/20 bg-cyan-950/10 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
            <ExternalLink className="w-4 h-4" /> {t('skills.importSkillUrlTitle')}
          </div>
        </div>

        <form onSubmit={handleUrlSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://raw.githubusercontent.com/.../SKILL.md"
            aria-label={t('skills.importSkillUrlTitle')}
            className="md:col-span-2 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={customNameInput}
              onChange={(e) => setCustomNameInput(e.target.value)}
              placeholder="Name"
              aria-label={t('skills.skillNamePlaceholder')}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            />
            <button
              type="submit"
              disabled={!urlInput.trim() || isLoading}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-xl transition-all shrink-0 flex items-center gap-1.5 focus-ring"
            >
              <Plus className="w-3.5 h-3.5" /> {t('skills.importUrlBtn')}
            </button>
          </div>
        </form>
      </div>

      {/* Hub Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('skills.searchPlaceholder')}
            aria-label={t('skills.searchPlaceholder')}
            className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div className="flex flex-wrap gap-1.5 self-start">
          {['all', 'frontend', 'backend', 'database', 'security', 'ai-ml', 'architecture'].map((cat) => (
            <button
              type="button"
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                selectedCategory === cat
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                  : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-300'
              }`}
            >
              {cat === 'all' ? t('common.all').toUpperCase() : t(CATEGORY_LABEL_KEYS[cat]).toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Loading state indicator - only unmount on initial empty fetch */}
      {isLoading && hubSkills.length === 0 ? (
        <div className="text-center py-12 text-slate-400 space-y-3">
          <Loader2 className="w-8 h-8 mx-auto text-cyan-400 animate-spin" />
          <p className="text-xs font-semibold text-slate-300">{t('common.loading')}...</p>
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="text-center py-10 text-slate-400 space-y-2">
          <Layers className="w-8 h-8 mx-auto text-slate-600" />
          <p className="text-sm">{t('skills.noSkillsFound')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredSkills.map((hubItem) => {
            const isInstallingThis = installingSkillId === hubItem.id
            const isExpanded = expandedSkillId === hubItem.id
            const isLoadingContent = loadingContentId === hubItem.id
            const rawInstructions = hubItem.rawContent || fetchedContents[hubItem.id]

            return (
              <div
                key={hubItem.id}
                className="p-4 rounded-xl border border-slate-800 bg-slate-950/40 hover:border-slate-700 transition-all flex flex-col justify-between space-y-3"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {getCategoryIcon(hubItem.category)}
                      <h3 className="text-sm font-bold text-slate-200">{hubItem.name}</h3>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                      v{hubItem.version}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{hubItem.description}</p>
                  <div className="flex items-center gap-2 text-[10px] font-mono text-cyan-300">
                    {hubItem.globalRank ? <span>#{hubItem.globalRank}</span> : null}
                    {hubItem.qualityScore !== undefined ? <span>quality {hubItem.qualityScore.toFixed(0)}/100</span> : null}
                    {hubItem.compatibility && hubItem.compatibility.status !== 'compatible' ? (
                      <span className="text-amber-300" title="Local compatibility probe">{hubItem.compatibility.status}</span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {hubItem.tags.map((tg) => (
                      <span key={tg} className="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-slate-400">
                        #{tg}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Instructions Expandable Section */}
                {isExpanded && (
                  <div className="space-y-2 pt-2 border-t border-slate-800/80 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                        <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                        {t('skills.skillContent')}
                      </span>
                      {rawInstructions && (
                        <button
                          type="button"
                          onClick={() => handleCopyContent(rawInstructions, hubItem.id)}
                          className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 transition-colors focus-ring"
                          title={t('skills.copyInstructions')}
                        >
                          {copiedSkillId === hubItem.id ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-400 font-medium">{t('common.copied')}</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>{t('skills.copyInstructions')}</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    {isLoadingContent ? (
                      <div className="p-4 rounded-lg bg-slate-950/80 border border-slate-800 text-center space-y-2">
                        <Loader2 className="w-4 h-4 animate-spin mx-auto text-cyan-400" />
                        <p className="text-[11px] text-slate-400">{t('common.loading')}...</p>
                      </div>
                    ) : rawInstructions ? (
                      <div className="p-3 bg-slate-950/90 border border-slate-800 rounded-lg text-[11px] text-slate-300 font-mono overflow-x-auto max-h-52 whitespace-pre-wrap leading-relaxed select-text shadow-inner">
                        {rawInstructions}
                      </div>
                    ) : (
                      <div className="p-3 bg-slate-950/90 border border-slate-800 rounded-lg text-xs text-slate-500 italic text-center">
                        {t('skills.noInstructionsAvailable')}
                      </div>
                    )}
                  </div>
                )}

                <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 truncate">
                    <span className="text-[11px] text-slate-400 font-medium truncate">{hubItem.author}</span>
                    <button
                      type="button"
                      onClick={() => handleToggleExpand(hubItem)}
                      className="text-[11px] text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1 font-medium shrink-0 focus-ring rounded cursor-pointer"
                    >
                      <FileText className="w-3 h-3" />
                      {isExpanded ? t('skills.hideInstructions') : t('skills.viewInstructions')}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onInstallSkill(hubItem.id)}
                    disabled={hubItem.isInstalled || isInstallingThis || !!installingSkillId}
                    aria-label={hubItem.isInstalled ? `${t('common.status')}: ${hubItem.name}` : `${t('skills.installBtn')} ${hubItem.name}`}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 focus-ring ${
                      hubItem.isInstalled
                        ? 'bg-slate-800/80 text-slate-400 cursor-default border border-slate-700/50'
                        : isInstallingThis
                        ? 'bg-cyan-900/80 text-cyan-200 cursor-wait border border-cyan-500/50'
                        : 'bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold active:scale-95 shadow-sm shadow-cyan-950/40'
                    }`}
                  >
                    {hubItem.isInstalled ? (
                      <>
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> {t('common.status')}
                      </>
                    ) : isInstallingThis ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-300" /> {t('common.loading')}...
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" /> {t('skills.installBtn')}
                      </>
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
