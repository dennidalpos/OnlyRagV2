import React, { useState } from 'react'
import { Modal } from './Modal'
import {
  X,
  Award,
  Code2,
  ExternalLink,
  Copy,
  Check,
  Heart,
  ShieldCheck,
  Package,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n'
import { OnlyRagLogo } from './OnlyRagLogo'
import { GithubIcon } from './GithubIcon'
import { logger } from '../../lib/logger'
import { APP_AUTHOR, APP_REPOSITORY_SLUG, APP_REPOSITORY_URL, APP_VERSION } from '../../constants/appMetadata'

export interface AboutModalProps {
  isOpen: boolean
  onClose: () => void
}

export type DependencyCategory = 'core' | 'aiAndVector' | 'uiAndEditor' | 'skillsAndEcosystem'

export interface DependencyItem {
  name: string
  version: string
  description: string
  license: string
  category: DependencyCategory
  url: string
}

export const UPSTREAM_MODULES: DependencyItem[] = [
  // Core & Desktop Runtime
  {
    name: 'Electron',
    version: 'v43.4.0',
    description: 'Cross-platform native desktop application shell and context-isolated IPC runtime.',
    license: 'MIT',
    category: 'core',
    url: 'https://www.electronjs.org',
  },
  {
    name: 'React 19',
    version: 'v19.0.0',
    description: 'Modern component-driven presentation layer with direct ref passing and concurrent rendering.',
    license: 'MIT',
    category: 'core',
    url: 'https://react.dev',
  },
  {
    name: 'TypeScript',
    version: 'v6.0.3',
    description: 'Strict static type checking and compile-time verification across main and renderer layers.',
    license: 'Apache-2.0',
    category: 'core',
    url: 'https://www.typescriptlang.org',
  },
  {
    name: 'Vite',
    version: 'v8.2.1',
    description: 'Next-generation frontend tooling with instant Hot Module Replacement (HMR).',
    license: 'MIT',
    category: 'core',
    url: 'https://vitejs.dev',
  },
  {
    name: 'Tailwind CSS',
    version: 'v4.0.7',
    description: 'High-performance atomic utility CSS engine and modern design tokens.',
    license: 'MIT',
    category: 'core',
    url: 'https://tailwindcss.com',
  },
  {
    name: 'Vitest',
    version: 'v4.1.10',
    description: 'Vite-native unit test runner for domain, application, and hook layers.',
    license: 'MIT',
    category: 'core',
    url: 'https://vitest.dev',
  },
  {
    name: 'Electron Builder',
    version: 'v26.15.3',
    description: 'Complete desktop application packaging and NSIS installer generation for Windows.',
    license: 'MIT',
    category: 'core',
    url: 'https://www.electron.build',
  },
  {
    name: 'p-queue',
    version: 'v9.3',
    description: 'Promise concurrency queue with priority dispatching for serial task execution.',
    license: 'MIT',
    category: 'core',
    url: 'https://github.com/sindresorhus/p-queue',
  },
  {
    name: 'TypeScript Compiler API',
    version: 'v5.x AST Engine',
    description: 'Programmatic AST parsing for code symbol extraction and structural repo mapping.',
    license: 'Apache-2.0',
    category: 'core',
    url: 'https://github.com/microsoft/TypeScript',
  },

  // AI, Vector Store & Sidecar
  {
    name: 'LanceDB',
    version: '>= v0.6.0',
    description: 'Serverless embedded vector database with hybrid vector similarity + FTS search.',
    license: 'Apache-2.0',
    category: 'aiAndVector',
    url: 'https://lancedb.com',
  },
  {
    name: 'Apache Arrow',
    version: 'Columnar Standard',
    description: 'Zero-copy in-memory columnar data structure backing LanceDB storage engine.',
    license: 'Apache-2.0',
    category: 'aiAndVector',
    url: 'https://arrow.apache.org',
  },
  {
    name: 'FlashRank',
    version: '>= v0.2.0',
    description: 'Ultra-fast in-process re-ranking engine for dense vector retrieval scoring.',
    license: 'Apache-2.0',
    category: 'aiAndVector',
    url: 'https://github.com/PrithivirajDamodaran/FlashRank',
  },
  {
    name: 'Ollama',
    version: 'REST API',
    description: '100% private local LLM & Vision model inference server (Llama, Qwen, DeepSeek, Nomic, BGE).',
    license: 'MIT',
    category: 'aiAndVector',
    url: 'https://ollama.com',
  },
  {
    name: 'FastAPI & Uvicorn',
    version: '>= v0.110 / v0.28',
    description: 'High-performance asynchronous Python sidecar REST API with non-blocking concurrency.',
    license: 'MIT / BSD-3',
    category: 'aiAndVector',
    url: 'https://fastapi.tiangolo.com',
  },
  {
    name: 'PyMuPDF (fitz)',
    version: '>= v1.24.0',
    description: 'High-speed document layout parsing, text extraction, and PDF compilation export.',
    license: 'AGPL-3.0 / Commercial',
    category: 'aiAndVector',
    url: 'https://pymupdf.readthedocs.io',
  },
  {
    name: 'RapidOCR (ONNX Runtime)',
    version: '>= v1.4.0',
    description: 'Cross-platform OCR engine for scanned document and image ingestion with CUDA auto-detection.',
    license: 'Apache-2.0',
    category: 'aiAndVector',
    url: 'https://github.com/RapidAI/RapidOCR',
  },
  {
    name: 'Pydantic',
    version: '>= v2.6.0',
    description: 'Strict data validation and schema serialization for sidecar request/response payloads.',
    license: 'MIT',
    category: 'aiAndVector',
    url: 'https://docs.pydantic.dev',
  },
  {
    name: 'HTTPX',
    version: '>= v0.27.0',
    description: 'Asynchronous HTTP client with connection pooling for Ollama streaming and sidecar IPC.',
    license: 'BSD-3-Clause',
    category: 'aiAndVector',
    url: 'https://www.python-httpx.org',
  },
  {
    name: 'OpenCV & Pillow',
    version: '>= v4.8 / v10.0',
    description: 'Computer vision image processing, binarization, deskewing, and OCR rasterization.',
    license: 'Apache-2.0 / MIT-CMU',
    category: 'aiAndVector',
    url: 'https://opencv.org',
  },
  {
    name: 'ftfy',
    version: '>= v6.2.0',
    description: 'Universal Unicode text repair, mojibake decoding, and character normalization.',
    license: 'Apache-2.0',
    category: 'aiAndVector',
    url: 'https://github.com/rspeer/ftfy',
  },
  {
    name: 'WordFreq & SymSpell',
    version: '>= v3.1 / v6.7',
    description: 'Multilingual token frequency scoring, spell checking, and OCR error correction.',
    license: 'Apache-2.0 / MIT',
    category: 'aiAndVector',
    url: 'https://github.com/rspeer/wordfreq',
  },
  {
    name: 'LangDetect & Tabulate',
    version: '>= v1.0 / v0.9',
    description: 'Multilingual document language detection and structured tabular Markdown formatting.',
    license: 'Apache-2.0 / MIT',
    category: 'aiAndVector',
    url: 'https://github.com/Mimino666/langdetect',
  },
  {
    name: 'NumPy & Pandas',
    version: '>= v1.26 / v2.0',
    description: 'High-performance numerical computation and tabular document data manipulation.',
    license: 'BSD-3-Clause',
    category: 'aiAndVector',
    url: 'https://numpy.org',
  },
  {
    name: 'python-docx',
    version: '>= v1.1.0',
    description: 'Microsoft Word (.docx) document parsing and structured text extraction.',
    license: 'MIT',
    category: 'aiAndVector',
    url: 'https://python-docx.readthedocs.io',
  },

  // UI, Monaco & Terminal
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
    version: 'v1.31.0',
    description: 'Clean, accessible, and consistent iconography system.',
    license: 'ISC',
    category: 'uiAndEditor',
    url: 'https://lucide.dev',
  },
  {
    name: 'node-pty',
    version: 'v1.1.0',
    description: 'Native pseudo-terminal integration for PowerShell interactive session execution.',
    license: 'MIT',
    category: 'uiAndEditor',
    url: 'https://github.com/microsoft/node-pty',
  },
  {
    name: 'TanStack Virtual',
    version: 'v3.14.10',
    description: 'Headless virtual scrolling for high-volume logs, timelines, and document lists.',
    license: 'MIT',
    category: 'uiAndEditor',
    url: 'https://tanstack.com/virtual',
  },
  {
    name: 'Diff (diff)',
    version: 'v9.0.0',
    description: 'Text and code diffing engine for line-by-line patch calculation and approval.',
    license: 'BSD-3-Clause',
    category: 'uiAndEditor',
    url: 'https://github.com/kpdecker/jsdiff',
  },
  {
    name: 'Strip ANSI',
    version: 'v7.2.0',
    description: 'ANSI escape code stripping for clean terminal log normalization and diagnostics.',
    license: 'MIT',
    category: 'uiAndEditor',
    url: 'https://github.com/chalk/strip-ansi',
  },

  // Skills, Ingestion & Web Scraping
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
  {
    name: 'Turndown & Cheerio',
    version: 'v7.2 / v1.2',
    description: 'HTML-to-Markdown conversion and fast DOM parsing for web research scrapers.',
    license: 'MIT',
    category: 'skillsAndEcosystem',
    url: 'https://github.com/mixmark-io/turndown',
  },
  {
    name: 'js-yaml',
    version: 'v4.1.0',
    description: 'Universal YAML parser and serializer for Skill manifests (SKILL.md) and provenance tracking.',
    license: 'MIT',
    category: 'skillsAndEcosystem',
    url: 'https://github.com/nodeca/js-yaml',
  },
  {
    name: 'JsonRepair',
    version: 'v3.15.0',
    description: 'Fault-tolerant JSON parser and auto-repair engine for LLM tool call payload extraction.',
    license: 'ISC',
    category: 'skillsAndEcosystem',
    url: 'https://github.com/josdejong/jsonrepair',
  },
  {
    name: 'Fast-Levenshtein',
    version: 'v3.0.0',
    description: 'Levenshtein distance string similarity calculation for typo-tolerant skill matching.',
    license: 'MIT',
    category: 'skillsAndEcosystem',
    url: 'https://github.com/hiddentao/fast-levenshtein',
  },
  {
    name: 'Ignore',
    version: 'v7.0.6',
    description: 'Gitignore rule matching and file system path filtering engine.',
    license: 'MIT',
    category: 'skillsAndEcosystem',
    url: 'https://github.com/kaelzhang/node-ignore',
  },
  {
    name: 'GPT-Tokenizer',
    version: 'v4.0.0',
    description: 'Fast BPE token counting (o200k_base) for agent context window budgeting.',
    license: 'MIT',
    category: 'skillsAndEcosystem',
    url: 'https://github.com/niieani/gpt-tokenizer',
  },
]

/** Filter tabs for the credits list. Short labels, localized like the rest of the dialog. */
export const CATEGORY_TABS: { id: string; labelKey: TranslationKey }[] = [
  { id: 'all', labelKey: 'about.tabAll' },
  { id: 'core', labelKey: 'about.tabCore' },
  { id: 'aiAndVector', labelKey: 'about.tabAiAndVector' },
  { id: 'uiAndEditor', labelKey: 'about.tabUiAndEditor' },
  { id: 'skillsAndEcosystem', labelKey: 'about.tabSkills' },
]

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation()
  const [copiedUrl, setCopiedUrl] = useState(false)

  const repoUrl = APP_REPOSITORY_URL

  const handleCopyRepo = async () => {
    try {
      await navigator.clipboard.writeText(repoUrl)
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2000)
    } catch (err: any) {
      logger.warn('AboutModal', `Failed copying repo url to clipboard: ${err?.message}`)
    }
  }

  const handleOpenExternal = (url: string) => {
    if (window.electronAPI?.openExternalUrl) {
      window.electronAPI.openExternalUrl(url)
    } else {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  if (!isOpen) return null

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      labelledById="about-modal-title"
      panelClassName="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-slate-100 relative"
    >
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
                <span
                  className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 font-mono"
                  title={t('common.version')}
                >
                  v{APP_VERSION}
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
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus-ring cursor-pointer"
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
                    {APP_AUTHOR}
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
                  <GithubIcon className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                    {t('about.repositoryTitle')}
                  </div>
                  <div className="text-xs font-mono font-semibold text-slate-200 truncate max-w-[160px]">
                    {APP_REPOSITORY_SLUG}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleOpenExternal(repoUrl)}
                  className="flex-1 py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 focus-ring cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> {t('about.openRepo')}
                </button>
                <button
                  type="button"
                  onClick={handleCopyRepo}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition-colors focus-ring cursor-pointer"
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
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <Package className="w-5 h-5 text-cyan-400" /> {t('about.creditsTitle')}
                  <span className="text-[11px] font-normal text-cyan-400/80 bg-cyan-950/40 px-2 py-0.5 rounded-full border border-cyan-800/40 font-mono">
                    {t('about.technologiesCount', { count: UPSTREAM_MODULES.length })}
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {t('about.creditsSubtitle')}
                </p>
              </div>

            </div>

            {/* Modules Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {UPSTREAM_MODULES.map((item) => (
                  <div
                    key={item.name}
                    className="p-3.5 rounded-xl bg-slate-950/60 hover:bg-slate-950 border border-slate-800/80 hover:border-slate-700 transition-all flex flex-col justify-between gap-2 group"
                  >
                    <div className="space-y-1.5">
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

                    <div className="pt-1.5 flex items-center justify-between border-t border-slate-900/80">
                      <span className="text-[10px] text-slate-500 font-medium capitalize">
                        {t(`about.categories.${item.category}` as any)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleOpenExternal(item.url)}
                        aria-label={`Open website for ${item.name}`}
                        className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity focus-ring rounded px-1 cursor-pointer"
                      >
                        <span>Web</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Special Acknowledgments & Open Standards */}
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/90 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Award className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-100">
                  {t('about.acknowledgmentsTitle')}
                </h4>
                <p className="text-[11px] text-slate-400">
                  {t('about.acknowledgmentsSubtitle')}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300">
                <strong className="text-cyan-400 block mb-0.5 font-semibold">Ollama</strong>
                {t('about.acknowledgmentsOllama')}
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300">
                <strong className="text-cyan-400 block mb-0.5 font-semibold">LanceDB</strong>
                {t('about.acknowledgmentsLanceDb')}
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300">
                <strong className="text-cyan-400 block mb-0.5 font-semibold">Anthropic</strong>
                {t('about.acknowledgmentsAnthropic')}
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300">
                <strong className="text-cyan-400 block mb-0.5 font-semibold">Microsoft Monaco &amp; TypeScript</strong>
                {t('about.acknowledgmentsMicrosoft')}
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300 sm:col-span-2">
                <strong className="text-cyan-400 block mb-0.5 font-semibold">Open-Weights Ecosystem</strong>
                {t('about.acknowledgmentsOpenWeights')}
              </div>
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
                type="button"
                onClick={() => handleOpenExternal(`${repoUrl}/issues`)}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 focus-ring active:scale-95 shadow-sm cursor-pointer"
              >
                <GithubIcon className="w-3.5 h-3.5" /> Issues &amp; Support
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
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors focus-ring active:scale-95 cursor-pointer"
          >
            {t('common.close')}
          </button>
        </div>
    </Modal>
  )
}

