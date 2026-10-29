import React from 'react'
import type { AgentMode } from '../../types'
import { useTranslation } from '../../i18n'

interface AgentModeSelectorProps {
  agentMode: AgentMode
  setAgentMode: (mode: AgentMode) => void
}

export const AgentModeSelector: React.FC<AgentModeSelectorProps> = ({ agentMode, setAgentMode }) => {
  const { t } = useTranslation()

  const modes: AgentMode[] = ['ask', 'guided', 'auto']

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const currentIdx = modes.indexOf(agentMode)
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      const nextMode = modes[(currentIdx + 1) % modes.length]
      setAgentMode(nextMode)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      const prevMode = modes[(currentIdx - 1 + modes.length) % modes.length]
      setAgentMode(prevMode)
    }
  }

  return (
    <div className="flex items-center gap-1 text-[10px] shrink-0">
      <div
        className="flex items-center bg-slate-900/90 rounded-xl border border-slate-800 p-0.5"
        role="radiogroup"
        aria-label="Azioni principali"
        onKeyDown={handleKeyDown}
      >
        <button
          type="button"
          role="radio"
          tabIndex={agentMode === 'ask' ? 0 : -1}
          aria-checked={agentMode === 'ask'}
          onClick={() => setAgentMode('ask')}
          title={`${t('coding.askMode')}: ${t('coding.askModeDesc')}`}
          className={`px-2 py-0.5 rounded-lg font-semibold transition-all focus-ring ${
            agentMode === 'ask' ? 'bg-amber-950 text-amber-300 font-bold border border-amber-800/80 shadow-sm' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {t('coding.askModeShort')}
        </button>
        <button
          type="button"
          role="radio"
          tabIndex={agentMode === 'guided' ? 0 : -1}
          aria-checked={agentMode === 'guided'}
          onClick={() => setAgentMode('guided')}
          title={`${t('coding.guidedMode')}: ${t('coding.guidedModeDesc')}`}
          className={`px-2 py-0.5 rounded-lg font-semibold transition-all focus-ring ${
            agentMode === 'guided' ? 'bg-cyan-950 text-cyan-300 font-bold border border-cyan-800/80 shadow-sm' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {t('coding.guidedModeShort')}
        </button>
        <button
          type="button"
          role="radio"
          tabIndex={agentMode === 'auto' ? 0 : -1}
          aria-checked={agentMode === 'auto'}
          onClick={() => setAgentMode('auto')}
          title={`${t('coding.autoMode')}: ${t('coding.autoModeDesc')}`}
          className={`px-2 py-0.5 rounded-lg font-semibold transition-all focus-ring ${
            agentMode === 'auto' ? 'bg-emerald-950 text-emerald-300 font-bold border border-emerald-800/80 shadow-sm' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {t('coding.autoModeShort')}
        </button>
      </div>
    </div>
  )
}
