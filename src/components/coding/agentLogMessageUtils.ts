/**
 * src/components/coding/agentLogMessageUtils.ts
 *
 * Presentation / Utility Layer — Language badges, model tag resolution, and log categorization.
 * Directly consumes structured fields from AgentActionLog (zero brittle string-scraping).
 */

import { AgentActionLog } from '../../types'

export function getStepModelName(message?: string, fallbackModelName?: string): string {
  if (!message) return fallbackModelName || 'LLM'

  const consultingMatch = message.match(/Consulting LLM \(([^)]+)\)/i)
  if (consultingMatch && consultingMatch[1]) {
    return consultingMatch[1].trim()
  }

  const complexityMatch = message.match(/(?:Complexity Escalated|Escalation a Deep Reasoning|Escalated to|Escalating to):\s*([a-zA-Z0-9._:\-]+)/i)
  if (complexityMatch && complexityMatch[1]) {
    return complexityMatch[1].trim()
  }

  const bracketMatch =
    message.match(/fallback to \[([^\]]+)\]/i) ||
    message.match(/Escalating to heavy tier \[([^\]]+)\]/i) ||
    message.match(/Primary model \[([^\]]+)\]/i) ||
    message.match(/Intermediate model \[([^\]]+)\]/i)

  if (bracketMatch && bracketMatch[1]) {
    return bracketMatch[1].trim()
  }

  return fallbackModelName || 'LLM'
}

export function getBadgeLang(filename?: string): { label: string; color: string } {
  if (!filename) return { label: 'FILE', color: 'bg-slate-800 text-slate-300' }
  const lower = filename.toLowerCase()

  if (lower.endsWith('.tsx') || lower.endsWith('.ts')) {
    return { label: 'TS', color: 'bg-sky-950 text-sky-400 border border-sky-800/80 font-bold' }
  }
  if (lower.endsWith('.jsx') || lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return { label: 'JS', color: 'bg-amber-950 text-amber-300 border border-amber-800/80 font-bold' }
  }
  if (lower.endsWith('.py')) {
    return { label: 'PY', color: 'bg-amber-950 text-amber-400 border border-amber-800/80 font-bold' }
  }
  if (lower.endsWith('.json')) {
    return { label: 'JSON', color: 'bg-emerald-950 text-emerald-400 border border-emerald-800/80 font-bold' }
  }
  if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.sass') || lower.endsWith('.less')) {
    return { label: 'CSS', color: 'bg-indigo-950 text-indigo-400 border border-indigo-800/80 font-bold' }
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return { label: 'HTML', color: 'bg-orange-950 text-orange-400 border border-orange-800/80 font-bold' }
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return { label: 'MD', color: 'bg-cyan-950 text-cyan-400 border border-cyan-800/80 font-bold' }
  }
  if (lower.endsWith('.ps1') || lower.endsWith('.bat') || lower.endsWith('.cmd')) {
    return { label: 'PS1', color: 'bg-purple-950 text-purple-400 border border-purple-800/80 font-bold' }
  }
  if (lower.endsWith('.sh') || lower.endsWith('.bash') || lower.endsWith('.zsh')) {
    return { label: 'SH', color: 'bg-emerald-950 text-emerald-300 border border-emerald-800/80 font-bold' }
  }
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) {
    return { label: 'YAML', color: 'bg-rose-950 text-rose-400 border border-rose-800/80 font-bold' }
  }
  if (lower.endsWith('.toml')) {
    return { label: 'TOML', color: 'bg-pink-950 text-pink-400 border border-pink-800/80 font-bold' }
  }
  if (lower.endsWith('.sql')) {
    return { label: 'SQL', color: 'bg-blue-950 text-blue-400 border border-blue-800/80 font-bold' }
  }
  if (lower.endsWith('.rs')) {
    return { label: 'RS', color: 'bg-orange-950 text-orange-300 border border-orange-800/80 font-bold' }
  }
  if (lower.endsWith('.go')) {
    return { label: 'GO', color: 'bg-teal-950 text-teal-300 border border-teal-800/80 font-bold' }
  }
  return { label: 'FILE', color: 'bg-slate-800 text-slate-300' }
}

export function extractBaseName(rawPath?: string): string {
  if (!rawPath) return ''
  const cleaned = rawPath.replace(/\s*\([^)]*\)$/, '').trim()
  const normalized = cleaned.replace(/\\/g, '/')
  const segments = normalized.split('/')
  return segments[segments.length - 1] || cleaned
}

export function resolveLogCategory(log: AgentActionLog): {
  category: AgentActionLog['category'] | 'user_prompt' | 'agent_question' | 'final_report' | 'file_mutation' | 'command_execution' | 'test_run' | 'workspace_exploration' | 'web_research' | 'generic_assistant'
  target: string
  verb?: string
  modelName?: string
} {
  if (log.category) {
    return {
      category: log.category,
      target: log.target || extractBaseName(log.message),
      verb: log.verb,
      modelName: log.modelName,
    }
  }

  // Fallback for legacy / unannotated logs
  const msg = log.message || ''
  if (msg.startsWith('User Prompt: ')) {
    return { category: 'user_prompt', target: '' }
  }
  if (msg.includes('❓ AI Agent Question:') || msg.startsWith('Agent Question:')) {
    return { category: 'agent_question', target: '' }
  }
  if (msg.startsWith('Task Finished:') || msg.startsWith('Task completed:')) {
    return { category: 'final_report', target: '' }
  }
  if (msg.includes('Test Run: PASS') || msg.includes('Test Run: FAIL') || msg.includes('run_tests')) {
    return { category: 'test_run', target: '' }
  }
  if (log.type === 'terminal' || msg.includes('run_command') || msg.startsWith('Ran ')) {
    return { category: 'command_execution', target: msg.replace(/^Ran\s+/, ''), verb: 'Ran' }
  }
  if (msg.includes('write_file') || msg.includes('Successfully wrote') || msg.includes('replace_chunk') || msg.includes('multi_replace') || msg.startsWith('Edited ')) {
    return { category: 'file_mutation', target: extractBaseName(msg), verb: msg.startsWith('Created') ? 'Created' : 'Edited' }
  }
  if (msg.includes('Loop') || msg.includes('Oscillation') || msg.includes('Intervention') || msg.includes('[SECURITY BLOCK]') || msg.includes('Error:')) {
    return { category: 'system_alert', target: '' }
  }

  return { category: 'generic_assistant', target: '' }
}
