import React from 'react'
import { Cpu, Check } from 'lucide-react'
import { HardwareProfile, AppSettings } from '../../types'

interface HardwareProfileSelectorProps {
  settings: AppSettings
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void
}

export const HardwareProfileSelector: React.FC<HardwareProfileSelectorProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const profiles: { id: HardwareProfile; name: string; desc: string; vram: string }[] = [
    { id: 'Auto', name: 'Auto (Recommended)', desc: 'Automatically scales VRAM context and thread allocation based on CUDA detection.', vram: 'Dynamic' },
    { id: 'Low', name: 'Low (CPU Only)', desc: 'Optimized for systems without dedicated GPU or lower RAM (4-8GB context).', vram: 'CPU RAM' },
    { id: 'Medium', name: 'Medium (Balanced)', desc: 'Balanced VRAM context allocation (8GB VRAM / 16GB RAM).', vram: '8 GB' },
    { id: 'High', name: 'High (Performance)', desc: 'Maximum context window and concurrency (12GB+ VRAM).', vram: '12+ GB' },
  ]

  return (
    <div className="glass-panel rounded-xl p-6 border border-slate-800 space-y-4">
      <div className="flex items-center gap-3">
        <Cpu className="w-5 h-5 text-cyan-400" />
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Hardware & VRAM Allocation Profile</h2>
          <p className="text-xs text-slate-400">Controls GPU VRAM context buffer and thread concurrency for Ollama and PyMuPDF sidecar</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" role="radiogroup" aria-label="Hardware profile selection">
        {profiles.map((p) => (
          <button
            type="button"
            key={p.id}
            role="radio"
            aria-checked={settings.hardwareProfile === p.id}
            onClick={() => onUpdateSettings({ hardwareProfile: p.id })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onUpdateSettings({ hardwareProfile: p.id })
              }
            }}
            className={`p-4 rounded-xl border cursor-pointer flex flex-col justify-between transition-all select-none text-left focus-ring active:scale-[0.98] ${
              settings.hardwareProfile === p.id
                ? 'bg-cyan-950/40 border-cyan-500 shadow-md shadow-cyan-950/30'
                : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div>
              <div className="flex items-center justify-between font-semibold text-slate-100 text-xs">
                <span>{p.name}</span>
                {settings.hardwareProfile === p.id && <Check className="w-4 h-4 text-cyan-400" />}
              </div>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">{p.desc}</p>
            </div>
            <div className="mt-4 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono">
              <span className="text-slate-500">Target VRAM:</span>
              <span className="text-cyan-300 font-semibold">{p.vram}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
