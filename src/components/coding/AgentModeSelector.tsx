import React from 'react'
import { AgentMode } from './CodingAgentView'
import { useTranslation } from '../../i18n'

interface AgentModeSelectorProps {
  agentMode: AgentMode
  setAgentMode: (mode: AgentMode) => void
}

export const AgentModeSelector: React.FC<AgentModeSelectorProps> = ({ agentMode, setAgentMode }) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center bg-slate-900/90 rounded-xl border border-slate-800 p-0.5 text-[10px] shrink-0" role="radiogroup" aria-label="Agent Mode">
      <button
        type="button"
        role="radio"
        tabIndex={agentMode === 'plan' ? 0 : -1}
        aria-checked={agentMode === 'plan'}
        onClick={() => setAgentMode('plan')}
        title={`${t('coding.planMode')}: ${t('coding.planModeDesc')}`}
        className={`px-2 py-0.5 rounded-lg font-semibold transition-all focus-ring ${
          agentMode === 'plan' ? 'bg-cyan-950 text-cyan-300 font-bold border border-cyan-800/80 shadow-sm' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        {t('coding.planModeShort')}
      </button>
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
        tabIndex={agentMode === 'agent' ? 0 : -1}
        aria-checked={agentMode === 'agent'}
        onClick={() => setAgentMode('agent')}
        title={`${t('coding.agentMode')}: ${t('coding.agentModeDesc')}`}
        className={`px-2 py-0.5 rounded-lg font-semibold transition-all focus-ring ${
          agentMode === 'agent' ? 'bg-emerald-950 text-emerald-300 font-bold border border-emerald-800/80 shadow-sm' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        {t('coding.agentModeShort')}
      </button>
    </div>
  )
}
