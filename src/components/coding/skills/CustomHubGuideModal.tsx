import React, { useState } from 'react'
import { X, BookOpen, Copy, Check, Code, FileText, Globe, Sparkles, Cpu, Layers } from 'lucide-react'
import { useTranslation } from '../../../i18n'

interface CustomHubGuideModalProps {
  isOpen: boolean
  onClose: () => void
}

const EXAMPLE_JSON_MANIFEST = `{
  "name": "My Custom AI Skills Hub",
  "description": "Hub aziendale di skill per architetture cloud e frontend",
  "skills": [
    {
      "id": "enterprise-standards",
      "name": "enterprise-standards",
      "description": "Standard aziendali di sicurezza e logging strutturato",
      "category": "security",
      "version": "1.0.0",
      "author": "Tech Lead",
      "tags": ["enterprise", "security", "logging"],
      "triggers": ["enterprise", "audit", "security"],
      "rawContent": "---\\nname: enterprise-standards\\ndescription: Standard aziendali di sicurezza\\nversion: 1.0.0\\nauthor: Tech Lead\\ntriggers: [enterprise, audit, security]\\ntags: [enterprise, security]\\n---\\n\\n# Enterprise Standards\\n\\n## 1. Logging\\n- Usa sempre JSON strutturato per i log."
    }
  ]
}`

const EXAMPLE_SKILL_MD = `---
name: nestjs-clean-architecture
description: "Pattern e best practice per microservizi NestJS e Prisma"
version: "1.0.0"
author: "Team Backend"
triggers: ["nestjs", "prisma", "microservice", "controller"]
tags: ["backend", "nestjs", "typescript"]
---

# NestJS Clean Architecture Guidelines

## 1. Moduli & Dependency Injection
- Separa sempre Controller, Service e Repository in moduli dedicati.
- Inietta i repository tramite interfaccia astratta.

## 2. Validazione DTO
- Usa \`class-validator\` e \`class-transformer\` per ogni payload di richiesta HTTP.
`

export const CustomHubGuideModal: React.FC<CustomHubGuideModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation()
  const [copiedType, setCopiedType] = useState<'json' | 'md' | 'anthropic' | 'lobe' | null>(null)

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

  const handleCopy = (text: string, type: 'json' | 'md' | 'anthropic' | 'lobe') => {
    navigator.clipboard.writeText(text)
    setCopiedType(type)
    setTimeout(() => setCopiedType(null), 2000)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-hub-guide-title"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 id="custom-hub-guide-title" className="text-base font-bold text-slate-100">{t('skills.guide.title')}</h2>
              <p className="text-xs text-slate-400">{t('skills.guide.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('skills.guide.closeAria')}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all focus-ring"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs text-slate-300 leading-relaxed">
          {/* Overview */}
          <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800 space-y-2">
            <h3 className="font-bold text-slate-200 text-sm flex items-center gap-2">
              <Globe className="w-4 h-4 text-cyan-400" /> {t('skills.guide.overviewTitle')}
            </h3>
            <p>
              {t('skills.guide.overviewText')}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px]">
              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                <strong className="text-emerald-300 flex items-center gap-1.5 mb-1">
                  <Layers className="w-3.5 h-3.5" /> {t('skills.guide.skillsShCardTitle')}
                </strong>
                <p className="text-slate-400">{t('skills.guide.skillsShCardText')}</p>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                <strong className="text-cyan-300 flex items-center gap-1.5 mb-1">
                  <Sparkles className="w-3.5 h-3.5" /> {t('skills.guide.anthropicCardTitle')}
                </strong>
                <p className="text-slate-400">{t('skills.guide.anthropicCardText')}</p>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                <strong className="text-purple-300 flex items-center gap-1.5 mb-1">
                  <Cpu className="w-3.5 h-3.5" /> {t('skills.guide.lobeHubCardTitle')}
                </strong>
                <p className="text-slate-400">{t('skills.guide.lobeHubCardText')}</p>
              </div>
            </div>
          </div>

          {/* Skills.sh standard */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-100 flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" /> {t('skills.guide.skillsShSectionTitle')}
            </h4>
            <p className="text-slate-400">
              {t('skills.guide.skillsShSectionText')}
            </p>
          </div>

          {/* Anthropic standard */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" /> {t('skills.guide.anthropicSectionTitle')}
            </h4>
            <p className="text-slate-400">
              {t('skills.guide.anthropicSectionText')}
            </p>
          </div>

          {/* LobeHub standard */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-100 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-purple-400" /> {t('skills.guide.lobeHubSectionTitle')}
            </h4>
            <p className="text-slate-400">
              {t('skills.guide.lobeHubSectionText')}
            </p>
          </div>

          {/* Format 1: JSON Catalog */}
          <div className="space-y-3 pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-slate-100 flex items-center gap-2">
                <Code className="w-4 h-4 text-emerald-400" /> {t('skills.guide.jsonFormatTitle')}
              </h4>
              <button
                type="button"
                onClick={() => handleCopy(EXAMPLE_JSON_MANIFEST, 'json')}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 transition-all flex items-center gap-1.5"
              >
                {copiedType === 'json' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedType === 'json' ? t('skills.guide.copiedLabel') : t('skills.guide.copyJsonBtn')}
              </button>
            </div>
            <p className="text-slate-400">
              {t('skills.guide.jsonFormatText')}
            </p>
            <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl overflow-x-auto font-mono text-[11px] text-slate-300">
              {EXAMPLE_JSON_MANIFEST}
            </pre>
          </div>

          {/* Format 2: Raw SKILL.md */}
          <div className="space-y-3 pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-slate-100 flex items-center gap-2">
                <FileText className="w-4 h-4 text-cyan-400" /> {t('skills.guide.mdFormatTitle')}
              </h4>
              <button
                type="button"
                onClick={() => handleCopy(EXAMPLE_SKILL_MD, 'md')}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 transition-all flex items-center gap-1.5"
              >
                {copiedType === 'md' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedType === 'md' ? t('skills.guide.copiedLabel') : t('skills.guide.copyMdBtn')}
              </button>
            </div>
            <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl overflow-x-auto font-mono text-[11px] text-slate-300">
              {EXAMPLE_SKILL_MD}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-all"
          >
            {t('skills.guide.closeBtn')}
          </button>
        </div>
      </div>
    </div>
  )
}
