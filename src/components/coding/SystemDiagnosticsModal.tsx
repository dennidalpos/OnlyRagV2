import React, { useState } from 'react'
import { Modal } from '../common/Modal'
import { X, Cpu, Wrench, ScanLine, Activity, CheckCircle2, AlertCircle, Terminal, FileCode, Folder, Layers, Check, Loader2, Sparkles } from 'lucide-react'
import { AppSettings, AgentActionLog, type GuestOsInfo } from '../../types'
import { formatClockTime } from '../../lib/timeFormat'
import { logger } from '../../lib/logger'
import { SlmDiagnosticsPanel } from './SlmDiagnosticsPanel'
import { useTranslation } from '../../i18n'

interface SystemDiagnosticsModalProps {
  isOpen: boolean
  onClose: () => void
  guestOsInfo: GuestOsInfo | null
  settings?: AppSettings
  actionLogs?: AgentActionLog[]
  isExecuting?: boolean
  activeModelName?: string
  openFilesCount?: number
  pinnedFilesCount?: number
  attachedDocsCount?: number
  sessionId?: string
  workspacePath?: string | null
  activeSkills?: string[]
}

export const SystemDiagnosticsModal: React.FC<SystemDiagnosticsModalProps> = ({
  isOpen,
  onClose,
  guestOsInfo,
  settings,
  actionLogs = [],
  isExecuting = false,
  activeModelName = '',
  openFilesCount = 0,
  pinnedFilesCount = 0,
  attachedDocsCount = 0,
  sessionId,
  workspacePath,
  activeSkills = [],
}) => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'system' | 'telemetry' | 'slm_logs'>('system')
  const [isCopyingDebugBundle, setIsCopyingDebugBundle] = useState<boolean>(false)
  const [isCopied, setIsCopied] = useState<boolean>(false)

  // ESC Key Listener for Accessibility

  const handleCopyAiDebugBundle = async () => {
    if (isCopyingDebugBundle) return
    setIsCopyingDebugBundle(true)
    try {
      if (window.electronAPI?.exportAiDebugBundle) {
        const bundle = await window.electronAPI.exportAiDebugBundle({
          sessionId: sessionId || 'latest-session',
          workspacePath,
          settings,
          activeModelName,
          activeSkills,
        })
        if (bundle) {
          await navigator.clipboard.writeText(bundle)
          setIsCopied(true)
          setTimeout(() => setIsCopied(false), 3000)
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('SystemDiagnosticsModal', `Failed copying AI debug bundle: ${msg}`)
    } finally {
      setIsCopyingDebugBundle(false)
    }
  }

  if (!isOpen) return null

  const hasGit = guestOsInfo?.tools.git
  const hasNode = guestOsInfo?.tools.node
  const hasPy = guestOsInfo?.tools.python
  const hasOllama = guestOsInfo?.tools.ollama

  const agentLogs = actionLogs.filter((log) => !log.message.startsWith('User Prompt: '))
  const totalSteps = agentLogs.length
  const fileOperationsCount = agentLogs.filter(
    (l) => l.category === 'file_mutation' || l.message.includes('write_file') || l.message.includes('replace_file'),
  ).length
  const terminalCommandsCount = agentLogs.filter((l) => l.category === 'command_execution' || l.type === 'terminal' || l.message.includes('run_command')).length
  const readOperationsCount = agentLogs.filter((l) => l.category === 'workspace_exploration' || l.message.includes('read_file')).length
  const lastLog = agentLogs[agentLogs.length - 1]
  const lastActivityTime = lastLog ? formatClockTime(lastLog.timestamp) : 'N/A'

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      labelledById="diagnostics-modal-title"
      panelClassName="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/80 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-sm">
            <Cpu className="w-4 h-4" />
          </div>
          <div>
            <h2 id="diagnostics-modal-title" className="text-sm font-bold text-slate-100 flex items-center gap-2">
              {t('systemDiagnostics.title')}
            </h2>
            <p className="text-[11px] text-slate-400">{t('systemDiagnostics.subtitle')}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopyAiDebugBundle}
            disabled={isCopyingDebugBundle}
            title={t('systemDiagnostics.copyBundleHint')}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl border transition-all cursor-pointer shadow-sm ${
              isCopied
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700'
                : 'bg-indigo-950/70 hover:bg-indigo-900/90 text-indigo-200 border-indigo-700/70 hover:border-indigo-500'
            }`}
          >
            {isCopyingDebugBundle ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : isCopied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            )}
            <span>{isCopied ? t('systemDiagnostics.bundleCopied') : t('systemDiagnostics.copyForAgent')}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="px-5 border-b border-slate-800 bg-slate-950/40 flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('system')}
          className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'system' ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Wrench className="w-3.5 h-3.5" />
          <span>{t('systemDiagnostics.tabToolchain')}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('telemetry')}
          className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'telemetry' ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>{t('systemDiagnostics.tabTelemetry')}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('slm_logs')}
          className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'slm_logs' ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <ScanLine className="w-3.5 h-3.5" />
          <span>{t('systemDiagnostics.tabSlmLogs')}</span>
        </button>
      </div>

      {/* Body Content */}
      <div className="flex-1 overflow-y-auto p-5 text-xs select-text">
        {activeTab === 'system' && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="font-bold text-slate-200 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-cyan-400" /> {t('systemDiagnostics.hardwareHost')}
                </span>
                <span className="text-[11px] font-mono text-cyan-300 bg-cyan-950/60 border border-cyan-800 px-2 py-0.5 rounded-lg">
                  {guestOsInfo?.platform || 'Windows'} (UTF-8)
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 font-mono text-[11px]">
                <div className="p-2.5 bg-slate-900/80 rounded-xl border border-slate-800 space-y-1">
                  <span className="text-slate-400 text-[10px]">{t('systemDiagnostics.hardwareProfile')}</span>
                </div>
                <div className="p-2.5 bg-slate-900/80 rounded-xl border border-slate-800 space-y-1">
                  <span className="text-slate-400 text-[10px]">{t('systemDiagnostics.activeModel')}</span>
                  <div className="font-bold text-indigo-300 truncate" title={activeModelName}>
                    {activeModelName || '—'}
                  </div>
                </div>
                <div className="p-2.5 bg-slate-900/80 rounded-xl border border-slate-800 space-y-1">
                  <span className="text-slate-400 text-[10px]">Ollama Endpoint</span>
                  <div className="font-bold text-emerald-400 truncate">{settings?.ollamaHost || 'localhost:11434'}</div>
                </div>
              </div>
            </div>

            {/* Toolchain Grid */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
              <span className="font-bold text-slate-200 flex items-center gap-2">
                <Wrench className="w-4 h-4 text-cyan-400" /> {t('systemDiagnostics.devToolchain')}
              </span>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
                <div className="flex items-center justify-between p-2 bg-slate-900/80 rounded-xl border border-slate-800">
                  <span className="text-slate-400">Git</span>
                  <span className={`text-[10px] font-bold flex items-center gap-1 ${hasGit ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {hasGit ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                    {hasGit ? 'OK' : 'N/A'}
                  </span>
                </div>

                <div className="flex items-center justify-between p-2 bg-slate-900/80 rounded-xl border border-slate-800">
                  <span className="text-slate-400">Node</span>
                  <span className={`text-[10px] font-bold flex items-center gap-1 ${hasNode ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {hasNode ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                    {hasNode ? 'OK' : 'N/A'}
                  </span>
                </div>

                <div className="flex items-center justify-between p-2 bg-slate-900/80 rounded-xl border border-slate-800">
                  <span className="text-slate-400">Python</span>
                  <span className={`text-[10px] font-bold flex items-center gap-1 ${hasPy ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {hasPy ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                    {hasPy ? 'OK' : 'N/A'}
                  </span>
                </div>

                <div className="flex items-center justify-between p-2 bg-slate-900/80 rounded-xl border border-slate-800">
                  <span className="text-slate-400">Ollama</span>
                  <span className={`text-[10px] font-bold flex items-center gap-1 ${hasOllama ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {hasOllama ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                    {hasOllama ? 'OK' : 'OFF'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'telemetry' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-bold text-slate-200 flex items-center gap-1.5">
                    <FileCode className="w-3.5 h-3.5 text-cyan-400" /> {t('systemDiagnostics.fileOperations')}
                  </span>
                  <span className="font-mono text-cyan-400 font-bold">{fileOperationsCount}</span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono">{t('systemDiagnostics.fileOperationsHint')}</div>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-bold text-slate-200 flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-amber-400" /> {t('systemDiagnostics.shellCommands')}
                  </span>
                  <span className="font-mono text-amber-400 font-bold">{terminalCommandsCount}</span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono">{t('systemDiagnostics.shellCommandsHint')}</div>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-bold text-slate-200 flex items-center gap-1.5">
                    <Folder className="w-3.5 h-3.5 text-indigo-400" /> {t('systemDiagnostics.reads')}
                  </span>
                  <span className="font-mono text-indigo-300 font-bold">{readOperationsCount}</span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono">{t('systemDiagnostics.readsHint')}</div>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-bold text-slate-200 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-emerald-400" /> {t('systemDiagnostics.totalSteps')}
                  </span>
                  <span className="font-mono text-emerald-400 font-bold">{totalSteps}</span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono">
                  {isExecuting ? t('systemDiagnostics.running') : t('systemDiagnostics.lastActivity', { time: lastActivityTime })}
                </div>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
              <span className="font-bold text-slate-200 block">{t('systemDiagnostics.contextResources')}</span>
              <div className="flex flex-wrap gap-2 text-xs font-mono">
                <span className="px-2.5 py-1 rounded-xl bg-slate-900 border border-slate-800 text-slate-300">
                  {t('systemDiagnostics.openFiles')} <strong className="text-cyan-300">{openFilesCount}</strong>
                </span>
                <span className="px-2.5 py-1 rounded-xl bg-slate-900 border border-slate-800 text-slate-300">
                  {t('systemDiagnostics.pinnedFiles')} <strong className="text-cyan-300">{pinnedFilesCount}</strong>
                </span>
                <span className="px-2.5 py-1 rounded-xl bg-slate-900 border border-slate-800 text-slate-300">
                  {t('systemDiagnostics.attachedDocs')} <strong className="text-emerald-300">{attachedDocsCount}</strong>
                </span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'slm_logs' && (
          <div className="space-y-4">
            <SlmDiagnosticsPanel />
          </div>
        )}
      </div>
    </Modal>
  )
}
