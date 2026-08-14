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
} from 'lucide-react'
import { HubSkillItem } from '../../../types'

interface MarketplaceSkillsListProps {
  hubSkills: HubSkillItem[]
  isLoading: boolean
  onInstallSkill: (skillId: string) => void
  onInstallFromUrl: (url: string, customName?: string) => void
}

export const MarketplaceSkillsList: React.FC<MarketplaceSkillsListProps> = ({
  hubSkills,
  isLoading,
  onInstallSkill,
  onInstallFromUrl,
}) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [urlInput, setUrlInput] = useState('')
  const [customNameInput, setCustomNameInput] = useState('')

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
      s.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()))
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
            <ExternalLink className="w-4 h-4" /> Importa Skill da URL / Raw GitHub
          </div>
        </div>

        <form onSubmit={handleUrlSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://raw.githubusercontent.com/.../SKILL.md"
            className="md:col-span-2 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={customNameInput}
              onChange={(e) => setCustomNameInput(e.target.value)}
              placeholder="Nome opzionale"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            />
            <button
              type="submit"
              disabled={!urlInput.trim() || isLoading}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-xl transition-all shrink-0 flex items-center gap-1.5 focus-ring"
            >
              <Plus className="w-3.5 h-3.5" /> Importa
            </button>
          </div>
        </form>
      </div>

      {/* Hub Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cerca skill, tag o framework..."
            className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div className="flex flex-wrap gap-1.5 self-start">
          {['all', 'frontend', 'backend', 'database', 'security', 'ai-ml', 'architecture'].map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                selectedCategory === cat
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                  : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-300'
              }`}
            >
              {cat.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Loading state indicator */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-400 space-y-3">
          <Loader2 className="w-8 h-8 mx-auto text-cyan-400 animate-spin" />
          <p className="text-xs font-semibold text-slate-300">Connessione ed aggiornamento skill dal sito remoto in corso...</p>
          <p className="text-[11px] text-slate-500">Download del catalogo e sincronizzazione dei manifest...</p>
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="text-center py-10 text-slate-500 space-y-2">
          <Layers className="w-8 h-8 mx-auto text-slate-600" />
          <p className="text-sm">Nessuna skill trovata per questa sorgente / ricerca.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredSkills.map((hubItem) => (
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
                <div className="flex flex-wrap gap-1">
                  {hubItem.tags.map((t) => (
                    <span key={t} className="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-slate-400">
                      #{t}
                    </span>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between">
                <span className="text-[11px] text-slate-500 font-medium">{hubItem.author}</span>
                <button
                  onClick={() => onInstallSkill(hubItem.id)}
                  disabled={hubItem.isInstalled || isLoading}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                    hubItem.isInstalled
                      ? 'bg-slate-800 text-slate-500 cursor-default'
                      : 'bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold'
                  }`}
                >
                  {hubItem.isInstalled ? (
                    <>
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> Installata
                    </>
                  ) : (
                    <>
                      <Download className="w-3.5 h-3.5" /> Installa Skill
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
