import React from 'react'
import type { AgentCapabilityProfile } from '../../types'
import { useTranslation } from '../../i18n'

interface AgentCapabilityProfileControlsProps {
  profile: AgentCapabilityProfile
  onChange: (profile: AgentCapabilityProfile) => void
  disabled?: boolean
}

/** Compact, reusable controls for the permissions applied to one Agent Coding run. */
export const AgentCapabilityProfileControls: React.FC<AgentCapabilityProfileControlsProps> = ({ profile, onChange, disabled = false }) => {
  const { t } = useTranslation()
  return (
    <fieldset disabled={disabled} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
      <legend className="px-1 text-[10px] font-bold uppercase tracking-wider text-cyan-300">{t('planInterview.runPermissions')}</legend>
      <div className="grid gap-2 sm:grid-cols-2 text-xs">
        <label className="flex items-center gap-2 text-slate-200">
          <input
            type="checkbox"
            checked={profile.allowFileModifications}
            onChange={(event) => onChange({ ...profile, allowFileModifications: event.target.checked })}
          />
          {t('planInterview.fileChanges')}
        </label>
        <label className="flex items-center gap-2 text-slate-200">
          <input
            type="checkbox"
            checked={profile.allowTerminalExecution}
            onChange={(event) => onChange({ ...profile, allowTerminalExecution: event.target.checked })}
          />
          {t('planInterview.terminalCommands')}
        </label>
        <label className="grid gap-1 text-slate-300">
          {t('planInterview.network')}
          <select
            value={profile.capabilityPolicyMode}
            onChange={(event) => onChange({ ...profile, capabilityPolicyMode: event.target.value as AgentCapabilityProfile['capabilityPolicyMode'] })}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
          >
            <option value="offline-strict">{t('planInterview.networkBlocked')}</option>
            <option value="local-only">{t('planInterview.networkLocal')}</option>
            <option value="network-approved">{t('planInterview.networkApproved')}</option>
          </select>
        </label>
        <label className="grid gap-1 text-slate-300">
          {t('planInterview.stepBudget')}
          <input
            type="number"
            min="10"
            max="200"
            disabled={profile.maxToolCallSteps === 0}
            value={profile.maxToolCallSteps === 0 ? 25 : profile.maxToolCallSteps}
            onChange={(event) => onChange({ ...profile, maxToolCallSteps: Number(event.target.value) || 10 })}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
          />
          <span className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={profile.maxToolCallSteps === 0}
              onChange={(event) => onChange({ ...profile, maxToolCallSteps: event.target.checked ? 0 : 25 })}
            />
            {t('planInterview.unlimited')}
          </span>
        </label>
      </div>
    </fieldset>
  )
}
