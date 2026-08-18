import React from 'react'
import {
  Activity,
  CheckCircle2,
  Clock,
  Loader2,
  Sparkles,
  Terminal,
  FileCode,
  Cpu,
  Folder,
  Layers,
  Zap,
} from 'lucide-react'
import { AgentActionLog } from '../../types'
import { formatClockTime } from '../../lib/timeFormat'
import { useTranslation } from '../../i18n'

interface ActivitiesPanelProps {
  actionLogs: AgentActionLog[]
  isExecuting: boolean
  activeSkills?: string[]
  agentPrompt?: string
  activeModelName?: string
  openFilesCount?: number
  pinnedFilesCount?: number
  attachedDocsCount?: number
}

export const ActivitiesPanel: React.FC<ActivitiesPanelProps> = ({
  actionLogs = [],
  isExecuting,
  activeSkills = [],
  agentPrompt = '',
  activeModelName = 'qwen2.5-coder:7b',
  openFilesCount = 0,
  pinnedFilesCount = 0,
  attachedDocsCount = 0,
}) => {
  const { t } = useTranslation()

  // Calculate telemetry metrics from action logs without duplicating full chat text
  const agentLogs = actionLogs.filter((log) => !log.message.startsWith('User Prompt: '))

  const totalSteps = agentLogs.length
  const fileOperationsCount = agentLogs.filter(
    (l) =>
      l.message.includes('write_file') ||
      l.message.includes('replace_chunk') ||
      l.message.includes('multi_replace') ||
      l.message.includes('delete_file') ||
      l.message.includes('Successfully wrote')
  ).length

  const terminalCommandsCount = agentLogs.filter(
    (l) =>
      l.type === 'terminal' ||
      l.message.includes('run_command') ||
      l.message.startsWith('Ran ') ||
      l.message.includes('Executing terminal command')
  ).length

  const readOperationsCount = agentLogs.filter(
    (l) => l.message.includes('read_file') || l.message.includes('grep_search') || l.message.includes('list_dir')
  ).length

  const lastLog = agentLogs[agentLogs.length - 1]
  const lastActivityTime = lastLog ? formatClockTime(lastLog.timestamp) : 'N/A'

  return (
    <div className="flex-1 h-full flex flex-col bg-[#0b0f17] select-text font-sans text-slate-200 overflow-y-auto">
      {/* Uniform Panel Top Header */}
      <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between shrink-0 sticky top-0 z-10 backdrop-blur-md">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
          <Activity className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>Telemetria &amp; Overview Agent</span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] px-2.5 py-0.5 rounded-full font-mono font-bold uppercase tracking-wider ${
              isExecuting
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-800 animate-pulse'
                : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
            }`}
          >
            {isExecuting ? 'Esecuzione in corso...' : 'In attesa (Idle)'}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4 max-w-4xl w-full mx-auto">
        {/* Live Active Execution Box (when running) */}
        {isExecuting && (
          <div className="p-4 rounded-2xl bg-gradient-to-r from-cyan-950/80 via-slate-900 to-indigo-950/80 border border-cyan-500/50 space-y-2.5 shadow-xl animate-in fade-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
                <span>Task in Esecuzione Real-Time</span>
              </div>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono font-bold border border-cyan-500/40 animate-pulse">
                ACTIVE TURN
              </span>
            </div>

            {agentPrompt && (
              <div className="text-xs text-slate-300 font-mono bg-slate-950/90 p-2.5 rounded-xl border border-slate-800 leading-relaxed line-clamp-2">
                <span className="text-cyan-400 font-bold">Prompt in corso: </span>
                {agentPrompt}
              </div>
            )}

            {activeSkills.length > 0 && (
              <div className="flex items-center gap-2 pt-1 text-xs text-slate-300">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="text-slate-400 text-[11px]">Skills attive:</span>
                <div className="flex flex-wrap gap-1">
                  {activeSkills.map((sk) => (
                    <span
                      key={sk}
                      className="px-2 py-0.5 rounded-md bg-cyan-500/20 text-cyan-300 font-mono text-[10px] font-bold border border-cyan-500/30"
                    >
                      {sk}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 4-Grid Telemetry Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Card 1: Tool Calls & Operations */}
          <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2 shadow-md">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-bold flex items-center gap-1.5 text-slate-200">
                <FileCode className="w-4 h-4 text-cyan-400" /> Operazioni File
              </span>
              <span className="font-mono text-cyan-400 font-bold">{fileOperationsCount}</span>
            </div>
            <div className="text-[11px] text-slate-400 space-y-1 font-mono pt-1 border-t border-slate-800/80">
              <div className="flex justify-between">
                <span>Scritture / Modifiche:</span>
                <span className="text-slate-200 font-bold">{fileOperationsCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Letture / Search:</span>
                <span className="text-slate-200 font-bold">{readOperationsCount}</span>
              </div>
            </div>
          </div>

          {/* Card 2: Shell / Terminal Commands */}
          <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2 shadow-md">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-bold flex items-center gap-1.5 text-slate-200">
                <Terminal className="w-4 h-4 text-amber-400" /> Comandi Shell
              </span>
              <span className="font-mono text-amber-400 font-bold">{terminalCommandsCount}</span>
            </div>
            <div className="text-[11px] text-slate-400 space-y-1 font-mono pt-1 border-t border-slate-800/80">
              <div className="flex justify-between">
                <span>Lanciati in Shell:</span>
                <span className="text-slate-200 font-bold">{terminalCommandsCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Monitoraggio 5s:</span>
                <span className="text-emerald-400 font-bold">Attivo</span>
              </div>
            </div>
          </div>

          {/* Card 3: Model & Router Telemetry */}
          <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2 shadow-md">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-bold flex items-center gap-1.5 text-slate-200">
                <Cpu className="w-4 h-4 text-indigo-400" /> Modello LLM
              </span>
              <span className="font-mono text-indigo-300 text-[10px] font-bold truncate max-w-[100px]">
                {activeModelName}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 space-y-1 font-mono pt-1 border-t border-slate-800/80">
              <div className="flex justify-between">
                <span>Routing Dinamico:</span>
                <span className="text-emerald-400 font-bold">Attivo</span>
              </div>
              <div className="flex justify-between">
                <span>Passi Totali:</span>
                <span className="text-slate-200 font-bold">{totalSteps}</span>
              </div>
            </div>
          </div>

          {/* Card 4: Workspace Resource Telemetry */}
          <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2 shadow-md">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-bold flex items-center gap-1.5 text-slate-200">
                <Folder className="w-4 h-4 text-emerald-400" /> Risorse Context
              </span>
              <span className="font-mono text-emerald-400 font-bold">{openFilesCount + pinnedFilesCount + attachedDocsCount}</span>
            </div>
            <div className="text-[11px] text-slate-400 space-y-1 font-mono pt-1 border-t border-slate-800/80">
              <div className="flex justify-between">
                <span>File Aperti:</span>
                <span className="text-slate-200 font-bold">{openFilesCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Pinned / RAG Docs:</span>
                <span className="text-slate-200 font-bold">{pinnedFilesCount + attachedDocsCount}</span>
              </div>
            </div>
          </div>
        </div>

        {/* System & Architecture Overview Card */}
        <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3 shadow-xl">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800/80 text-xs font-bold text-slate-200">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              <span>Ambiente &amp; Telemetria Sistema</span>
            </div>
            <span className="text-[10px] font-mono text-slate-400">Ultimo Aggiornamento: {lastActivityTime}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-1">
              <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider block">Sistema Operativo Target</span>
              <div className="text-slate-200 font-bold flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Windows / PowerShell (UTF-8)
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-1">
              <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">Real-time Shell Monitor</span>
              <div className="text-slate-200 font-bold flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" /> Auto-open tab dopo 5s di esecuzione shell
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
