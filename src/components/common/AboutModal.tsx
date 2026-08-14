import React, { useState } from 'react'
import {
  X,
  Github,
  Award,
  BookOpen,
  Code2,
  Cpu,
  Layers,
  Sparkles,
  ExternalLink,
  Copy,
  Check,
  Heart,
  FileText,
  ShieldCheck,
  Package,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { OnlyRagLogo } from './OnlyRagLogo'

interface AboutModalProps {
  isOpen: boolean
  onClose: () => void
}

interface DependencyItem {
  name: string
  version: string
  description: string
  license: string
  category: 'core' | 'aiAndVector' | 'uiAndEditor' | 'skillsAndEcosystem'
  url: string
}

const UPSTREAM_MODULES: DependencyItem[] = [
  // Core
  {
    name: 'Electron',
    version: 'v43.4.0',
    description: 'Cross-platform native desktop application shell and IPC runtime.',
    license: 'MIT',
    category: 'core',
    url: 'https://www.electronjs.org',
  },
  {
    name: 'React 19 & TypeScript',
    version: 'v19.0.0 / v6.0',
    description: 'Modern component-driven presentation layer with strict compile-time types.',
    license: 'MIT',
    category: 'core',
    url: 'https://react.dev',
  },
  {
    name: 'Vite & Tailwind CSS v4',
    version: 'v7.3 / v4.0',
    description: 'Ultra-fast HMR frontend bundling and high-performance design tokens.',
    license: 'MIT',
    category: 'core',
    url: 'https://vitejs.dev',
  },
  // AI & Vector
  {
    name: 'LanceDB',
    version: 'v0.25.0',
    description: 'Serverless embedded vector database with hybrid vector + FTS search.',
    license: 'Apache-2.0',
    category: 'aiAndVector',
    url: 'https://lancedb.com',
  },
  {
    name: 'Ollama',
    version: 'REST API',
    description: '100% private local LLM & Vision model inference server.',
    license: 'MIT',
    category: 'aiAndVector',
    url: 'https://ollama.com',
  },
  {
    name: 'FastAPI & Uvicorn',
    version: 'v0.115.0',
    description: 'High-performance asynchronous Python sidecar service for ingestion and parsing.',
    license: 'MIT',
    category: 'aiAndVector',
    url: 'https://fastapi.tiangolo.com',
  },
  {
    name: 'PyMuPDF (fitz)',
    version: 'v1.25.0',
    description: 'High-speed document layout parsing and multi-format PDF compiler.',
    license: 'AGPL-3.0 / Commercial',
    category: 'aiAndVector',
    url: 'https://pymupdf.readthedocs.io',
  },
  // UI & Editor
  {
    name: 'Monaco Editor',
    version: 'v4.7.0',
    description: 'VS Code editor engine for dual-pane Markdown review and DiffEditor translation.',
    license: 'MIT',
    category: 'uiAndEditor',
    url: 'https://microsoft.github.io/monaco-editor',
  },
  {
    name: 'Lucide React',
    version: 'v0.475.0',
    description: 'Clean, beautiful and consistent iconography system.',
    license: 'ISC',
    category: 'uiAndEditor',
    url: 'https://lucide.dev',
  },
  {
    name: 'node-pty',
    version: 'v1.1.0',
    description: 'Interactive pseudo-terminal integration for native PowerShell session execution.',
    license: 'MIT',
    category: 'uiAndEditor',
    url: 'https://github.com/microsoft/node-pty',
  },
  // Skills & Ecosystem
  {
    name: 'Skills.sh Directory',
    version: 'Ecosystem',
    description: 'Open agent skill directory and interoperable task specifications.',
    license: 'Open Source',
    category: 'skillsAndEcosystem',
    url: 'https://skills.sh',
  },
  {
    name: 'Anthropic Agent Skills',
    version: 'agentskills.io',
    description: 'Open standard for domain-specific agent skill guidelines and SKILL.md format.',
    license: 'Apache-2.0',
    category: 'skillsAndEcosystem',
    url: 'https://agentskills.io',
  },
  {
    name: 'LobeHub Marketplace',
    version: 'Plugin Index',
    description: 'Community plugin catalog and standard skill schema normalization.',
    license: 'MIT',
    category: 'skillsAndEcosystem',
    url: 'https://lobehub.com',
  },
]

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation()
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string>('all')

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

  const repoUrl = 'https://github.com/dennidalpos/OnlyRagV2'

  const handleCopyRepo = async () => {
    try {
      await navigator.clipboard.writeText(repoUrl)
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2000)
    } catch {}
  }

  const handleOpenExternal = (url: string) => {
    if (window.electronAPI?.openExternalUrl) {
      window.electronAPI.openExternalUrl(url)
    } else {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  const filteredModules = selectedCategory === 'all'
    ? UPSTREAM_MODULES
    : UPSTREAM_MODULES.filter((m) => m.category === selectedCategory)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="bg-slate-900 border border-slate-800 w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100 relative">
        {/* Top Header Banner */}
        <div className="relative p-6 border-b border-slate-800/80 bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/40 flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-slate-950 border border-cyan-500/30 p-2 flex items-center justify-center shadow-xl shadow-cyan-950/50 relative overflow-hidden group">
              <div className="absolute inset-0 bg-cyan-500/15 group-hover:bg-cyan-500/25 transition-colors" />
              <OnlyRagLogo className="w-full h-full object-contain relative z-10 drop-shadow-[0_0_12px_rgba(34,211,238,0.7)]" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 id="about-modal-title" className="text-2xl font-black tracking-tight text-white">
                  {t('about.title')}
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 font-mono">
                  {t('common.version')}
                </span>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {t('about.licenseType')}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 font-medium max-w-xl">
                {t('about.subtitle')}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus-ring"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 select-text">
          {/* Metadata Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Author Card */}
            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/90 flex flex-col justify-between space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <Award className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                    {t('about.authorTitle')}
                  </div>
                  <div className="text-sm font-bold text-slate-100">
                    {t('common.author')}
                  </div>
                </div>
              </div>
              <div className="text-xs text-slate-400">
                {t('about.authorRole')}
              </div>
            </div>

            {/* Repository Card */}
            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/90 flex flex-col justify-between space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  <Github className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                    {t('about.repositoryTitle')}
                  </div>
                  <div className="text-xs font-mono font-semibold text-slate-200 truncate max-w-[160px]">
                    dennidalpos/OnlyRagV2
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => handleOpenExternal(repoUrl)}
                  className="flex-1 py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 focus-ring"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> {t('about.openRepo')}
                </button>
                <button
                  onClick={handleCopyRepo}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition-colors focus-ring"
                  title={t('about.copyUrl')}
                  aria-label={t('about.copyUrl')}
                >
                  {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* License Card */}
            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/90 flex flex-col justify-between space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                    {t('about.licenseTitle')}
                  </div>
                  <div className="text-sm font-bold text-emerald-400 font-mono">
                    {t('about.licenseType')}
                  </div>
                </div>
              </div>
              <div className="text-[11px] text-slate-400 leading-tight">
                {t('about.licenseNotice')}
              </div>
            </div>
          </div>

          {/* Upstream Modules & Open Source Credits */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <Package className="w-5 h-5 text-cyan-400" /> {t('about.creditsTitle')}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {t('about.creditsSubtitle')}
                </p>
              </div>

              {/* Category Filter Tabs */}
              <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px]" role="tablist" aria-label="Filtro categorie moduli">
                <button
                  role="tab"
                  aria-selected={selectedCategory === 'all'}
                  onClick={() => setSelectedCategory('all')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors focus-ring cursor-pointer ${
                    selectedCategory === 'all'
                      ? 'bg-slate-800 text-cyan-300 font-semibold shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Tutti
                </button>
                <button
                  role="tab"
                  aria-selected={selectedCategory === 'core'}
                  onClick={() => setSelectedCategory('core')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors focus-ring cursor-pointer ${
                    selectedCategory === 'core'
                      ? 'bg-slate-800 text-cyan-300 font-semibold shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Core
                </button>
                <button
                  role="tab"
                  aria-selected={selectedCategory === 'aiAndVector'}
                  onClick={() => setSelectedCategory('aiAndVector')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors focus-ring cursor-pointer ${
                    selectedCategory === 'aiAndVector'
                      ? 'bg-slate-800 text-cyan-300 font-semibold shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  AI &amp; DB
                </button>
                <button
                  role="tab"
                  aria-selected={selectedCategory === 'uiAndEditor'}
                  onClick={() => setSelectedCategory('uiAndEditor')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors focus-ring cursor-pointer ${
                    selectedCategory === 'uiAndEditor'
                      ? 'bg-slate-800 text-cyan-300 font-semibold shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  UI &amp; Monaco
                </button>
                <button
                  role="tab"
                  aria-selected={selectedCategory === 'skillsAndEcosystem'}
                  onClick={() => setSelectedCategory('skillsAndEcosystem')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors focus-ring cursor-pointer ${
                    selectedCategory === 'skillsAndEcosystem'
                      ? 'bg-slate-800 text-cyan-300 font-semibold shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Skills
                </button>
              </div>
            </div>

            {/* Modules Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredModules.map((item) => (
                <div
                  key={item.name}
                  className="p-3.5 rounded-xl bg-slate-950/60 hover:bg-slate-950 border border-slate-800/80 hover:border-slate-700 transition-all flex flex-col justify-between gap-2 group"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-slate-100 group-hover:text-cyan-300 transition-colors">
                          {item.name}
                        </span>
                        <span className="text-[10px] font-mono text-cyan-400/80 bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-800/40">
                          {item.version}
                        </span>
                      </div>
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                        {item.license}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-snug">
                      {item.description}
                    </p>
                  </div>

                  <div className="pt-1 flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 font-medium capitalize">
                      {t(`about.categories.${item.category}` as any)}
                    </span>
                    <button
                      onClick={() => handleOpenExternal(item.url)}
                      aria-label={`Open website for ${item.name}`}
                      className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity focus-ring rounded px-1"
                    >
                      <span>Web</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Contacts & Community Links */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-slate-950 to-cyan-950/30 border border-slate-800/90 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                <Heart className="w-5 h-5 fill-cyan-500/20 text-cyan-400" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-100">
                  {t('about.contactsTitle')}
                </h4>
                <p className="text-[11px] text-slate-400">
                  {t('about.contactsSubtitle')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleOpenExternal(`${repoUrl}/issues`)}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 focus-ring active:scale-95 shadow-sm"
              >
                <Github className="w-3.5 h-3.5" /> Issues &amp; Support
              </button>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <Code2 className="w-3.5 h-3.5 text-cyan-400" /> Built with Clean Architecture &amp; 100% Local AI
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors focus-ring active:scale-95"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
