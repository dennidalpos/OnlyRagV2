export function getStepModelName(message: string, fallbackModelName?: string): string {
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
  if (filename.endsWith('.tsx') || filename.endsWith('.ts')) return { label: 'TS', color: 'bg-sky-950 text-sky-400 border border-sky-800/80 font-bold' }
  if (filename.endsWith('.py')) return { label: 'PY', color: 'bg-amber-950 text-amber-400 border border-amber-800/80 font-bold' }
  if (filename.endsWith('.json')) return { label: 'JSON', color: 'bg-emerald-950 text-emerald-400 border border-emerald-800/80 font-bold' }
  if (filename.endsWith('.css')) return { label: 'CSS', color: 'bg-indigo-950 text-indigo-400 border border-indigo-800/80 font-bold' }
  if (filename.endsWith('.md')) return { label: 'MD', color: 'bg-cyan-950 text-cyan-400 border border-cyan-800/80 font-bold' }
  return { label: 'TXT', color: 'bg-slate-800 text-slate-300' }
}
