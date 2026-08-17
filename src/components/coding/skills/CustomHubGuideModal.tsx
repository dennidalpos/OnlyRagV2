import React, { useState } from 'react'
import { X, BookOpen, Copy, Check, Code, FileText, Globe, Sparkles, Cpu, Layers } from 'lucide-react'

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
              <h2 id="custom-hub-guide-title" className="text-base font-bold text-slate-100">Guida alla Struttura di Skill Hub &amp; Repository</h2>
              <p className="text-xs text-slate-400">Come integrare Skills.sh, Anthropic, LobeHub e Hub personalizzati in OnlyRag V2</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi guida"
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
              <Globe className="w-4 h-4 text-cyan-400" /> Sorgenti Ufficiali e Formati Supportati
            </h3>
            <p>
              OnlyRag V2 supporta nativamente l'interoperabilità con i principali ecosistemi di AI Agent e repository open standard:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px]">
              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                <strong className="text-emerald-300 flex items-center gap-1.5 mb-1">
                  <Layers className="w-3.5 h-3.5" /> Skills.sh Open Directory
                </strong>
                <p className="text-slate-400">Registry universale (<code className="text-slate-300 font-mono">skills.sh</code>) con skill comunitarie per ingegneria del software (<code className="text-slate-300 font-mono">grill-me</code>, <code className="text-slate-300 font-mono">tdd</code>, <code className="text-slate-300 font-mono">code-review</code>).</p>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                <strong className="text-cyan-300 flex items-center gap-1.5 mb-1">
                  <Sparkles className="w-3.5 h-3.5" /> Anthropic Agent Skills
                </strong>
                <p className="text-slate-400">Standard <code className="text-slate-300 font-mono">agentskills.io</code> (repository <code className="text-slate-300 font-mono">github.com/anthropics/skills</code> con cartelle <code className="text-slate-300 font-mono">skills/&lt;nome&gt;/SKILL.md</code>).</p>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                <strong className="text-purple-300 flex items-center gap-1.5 mb-1">
                  <Cpu className="w-3.5 h-3.5" /> LobeHub Marketplace
                </strong>
                <p className="text-slate-400">Marketplace (<code className="text-slate-300 font-mono">lobehub.com/skills</code>) alimentato da registry JSON live (<code className="text-slate-300 font-mono">chat-plugins.lobehub.com</code>).</p>
              </div>
            </div>
          </div>

          {/* Skills.sh standard */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-100 flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" /> 1. Skills.sh Ecosystem (`https://www.skills.sh/`)
            </h4>
            <p className="text-slate-400">
              Skills.sh è l'ecosistema aperto per scoprire e installare skill per AI agent (Claude Code, Cursor, Copilot, Antigravity). OnlyRag V2 integra direttamente le skill più popolari della directory come <code className="text-emerald-300 font-mono">grill-me</code> (intervista rigorosa prima del codice), <code className="text-emerald-300 font-mono">grill-with-docs</code>, <code className="text-emerald-300 font-mono">code-review</code>, <code className="text-emerald-300 font-mono">diagnosing-bugs</code> e <code className="text-emerald-300 font-mono">tdd</code>.
            </p>
          </div>

          {/* Anthropic standard */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" /> 2. Standard Anthropic Agent Skills (`agentskills.io`)
            </h4>
            <p className="text-slate-400">
              Anthropic definisce le skill come cartelle contenenti un file <code className="text-cyan-300 font-mono">SKILL.md</code> con frontmatter YAML e istruzioni dettagliate.
              Per aggiungere un repository simile come Hub personalizzato, inserisci l'URL GitHub (es. <code className="text-slate-300 font-mono">https://github.com/anthropics/skills</code>) e seleziona il tipo <strong>Repository GitHub</strong>.
            </p>
          </div>

          {/* LobeHub standard */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-100 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-purple-400" /> 3. Standard LobeHub Marketplace (`lobehub.com/skills`)
            </h4>
            <p className="text-slate-400">
              LobeHub espone i propri plugin e skill tramite un endpoint JSON con struttura <code className="text-purple-300 font-mono">plugins: [ &#123; identifier, meta, manifest &#125; ]</code>.
              OnlyRag V2 effettua il parsing automatico di questi manifest e genera al volo le linee guida per l'AI Agent locale.
            </p>
          </div>

          {/* Format 1: JSON Catalog */}
          <div className="space-y-3 pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-slate-100 flex items-center gap-2">
                <Code className="w-4 h-4 text-emerald-400" /> 4. Formato Catalogo JSON Personalizzato (`hub.json`)
              </h4>
              <button
                type="button"
                onClick={() => handleCopy(EXAMPLE_JSON_MANIFEST, 'json')}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 transition-all flex items-center gap-1.5"
              >
                {copiedType === 'json' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedType === 'json' ? 'Copiato!' : 'Copia Esempio JSON'}
              </button>
            </div>
            <p className="text-slate-400">
              Se crei un tuo server HTTP/HTTPS o file statico, puoi esporre un JSON con una lista <code className="text-cyan-300 font-mono">skills</code>:
            </p>
            <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl overflow-x-auto font-mono text-[11px] text-slate-300">
              {EXAMPLE_JSON_MANIFEST}
            </pre>
          </div>

          {/* Format 2: Raw SKILL.md */}
          <div className="space-y-3 pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-slate-100 flex items-center gap-2">
                <FileText className="w-4 h-4 text-cyan-400" /> 5. Formato Documento Singolo `SKILL.md` (YAML Frontmatter)
              </h4>
              <button
                type="button"
                onClick={() => handleCopy(EXAMPLE_SKILL_MD, 'md')}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 transition-all flex items-center gap-1.5"
              >
                {copiedType === 'md' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedType === 'md' ? 'Copiato!' : 'Copia SKILL.md'}
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
            Chiudi Guida
          </button>
        </div>
      </div>
    </div>
  )
}
