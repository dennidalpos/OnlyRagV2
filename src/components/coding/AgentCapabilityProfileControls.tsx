import React from 'react'
import type { AgentCapabilityProfile } from '../../types'

interface AgentCapabilityProfileControlsProps {
  profile: AgentCapabilityProfile
  onChange: (profile: AgentCapabilityProfile) => void
  disabled?: boolean
}

/** Compact, reusable controls for the permissions applied to one Agent Coding run. */
export const AgentCapabilityProfileControls: React.FC<AgentCapabilityProfileControlsProps> = ({ profile, onChange, disabled = false }) => (
  <fieldset disabled={disabled} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
    <legend className="px-1 text-[10px] font-bold uppercase tracking-wider text-cyan-300">Permessi della run</legend>
    <div className="grid gap-2 sm:grid-cols-2 text-xs">
      <label className="flex items-center gap-2 text-slate-200">
        <input type="checkbox" checked={profile.allowFileModifications} onChange={(event) => onChange({ ...profile, allowFileModifications: event.target.checked })} />
        Modifiche ai file
      </label>
      <label className="flex items-center gap-2 text-slate-200">
        <input type="checkbox" checked={profile.allowTerminalExecution} onChange={(event) => onChange({ ...profile, allowTerminalExecution: event.target.checked })} />
        Comandi terminale
      </label>
      <label className="grid gap-1 text-slate-300">
        Rete
        <select value={profile.capabilityPolicyMode} onChange={(event) => onChange({ ...profile, capabilityPolicyMode: event.target.value as AgentCapabilityProfile['capabilityPolicyMode'] })} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100">
          <option value="offline-strict">Bloccata</option>
          <option value="local-only">Solo locale</option>
          <option value="network-approved">Con approvazione</option>
        </select>
      </label>
      <label className="grid gap-1 text-slate-300">
        Budget di step
        <input type="number" min="5" max="100" value={profile.maxToolCallSteps} onChange={(event) => onChange({ ...profile, maxToolCallSteps: Number(event.target.value) || 5 })} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100" />
      </label>
    </div>
  </fieldset>
)
