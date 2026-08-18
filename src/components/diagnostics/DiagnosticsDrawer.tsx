import React, { useState, useEffect, useRef } from 'react'
import { DiagnosticsData, LogEntry } from '../../types'
import { apiService } from '../../services/api'
import {
  Terminal,
  RefreshCw,
  Trash2,
  Cpu,
  HardDrive,
  Zap,
  X,
  Copy,
  Check,
  FolderOpen,
  Sliders,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { OllamaEnvParamsModal } from './OllamaEnvParamsModal'
import { OllamaEnvApprovalModal } from './OllamaEnvApprovalModal'
import { useOllamaEnvParams } from '../../hooks/useOllamaEnvParams'

interface DiagnosticsDrawerProps {
  isOpen: boolean
  onClose: () => void
  diagnostics: DiagnosticsData | null
  onRefreshDiagnostics: () => void
}

export const DiagnosticsDrawer: React.FC<DiagnosticsDrawerProps> = ({
  isOpen,
  onClose,
  diagnostics,
  onRefreshDiagnostics,
}) => {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logPath, setLogPath] = useState<string>('')
  const [selectedLevel, setSelectedLevel] = useState<string>('ALL')
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [isRefreshingLogs, setIsRefreshingLogs] = useState<boolean>(false)
  const [copiedReport, setCopiedReport] = useState<boolean>(false)
  const [autoScroll, setAutoScroll] = useState<boolean>(false)
  const consoleBottomRef = useRef<HTMLDivElement | null>(null)

  const {
    envConfig,
    showEnvParamsModal,
    setShowEnvParamsModal,
    showApprovalModal,
    setShowApprovalModal,
    isApplyingEnvVars,
    restartOllamaAfterApply,
    setRestartOllamaAfterApply,
    applyEnvFeedback,
    handleApplyEnvVars,
  } = useOllamaEnvParams(diagnostics, onRefreshDiagnostics)

  const fetchLogs = async () => {
    setIsRefreshingLogs(true)
    const fetchedLogs = await apiService.getLogs()
    let pathStr = ''
    if (window.electronAPI) {
      pathStr = await window.electronAPI.getLogFilePath()
    }
    setLogs(fetchedLogs)
    setLogPath(pathStr)
    setIsRefreshingLogs(false)
  }

  useEffect(() => {
    if (isOpen) {
      fetchLogs()
      const interval = setInterval(fetchLogs, 2500)
      return () => clearInterval(interval)
    }
  }, [isOpen])

  useEffect(() => {
    if (autoScroll && consoleBottomRef.current) {
      consoleBottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, autoScroll])

  const [isRestartingSidecar, setIsRestartingSidecar] = useState<boolean>(false)

  const handleRestartSidecar = async () => {
    if (window.electronAPI) {
      setIsRestartingSidecar(true)
      await window.electronAPI.restartSidecar()
      onRefreshDiagnostics()
      setIsRestartingSidecar(false)
    }
  }

  const [cleanMessage, setCleanMessage] = useState<string | null>(null)

  const handleCleanResiduals = async () => {
    if (window.electronAPI?.cleanTempResiduals) {
      const res = await window.electronAPI.cleanTempResiduals()
      setCleanMessage(`Cleaned ${res.cleanedCount} files (${(res.bytesFreed / 1024 / 1024).toFixed(2)} MB freed)`)
      setTimeout(() => setCleanMessage(null), 4000)
    }
  }

  const handleClear = async () => {
    if (window.electronAPI) {
      await window.electronAPI.clearLogs()
      setLogs([])
    }
  }

  const categories = Array.from(new Set(logs.map((l) => l.category).filter(Boolean))).sort()

  const errorCount = logs.filter((l) => l.level === 'ERROR').length
  const warnCount = logs.filter((l) => l.level === 'WARN').length

  const filteredLogs = logs.filter((log) => {
    const matchesLevel = selectedLevel === 'ALL' || log.level === selectedLevel
    const matchesCategory = selectedCategory === 'ALL' || log.category === selectedCategory
    const matchesSearch =
      log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.category.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesLevel && matchesCategory && matchesSearch
  })

  const generateReportMarkdown = (): string => {
    if (!diagnostics) return 'No diagnostics data available.'
    return `# OnlyRag V2 - System Diagnostics & Health Report
Generated at: ${diagnostics.timestamp}

## System Overview
- **Platform:** ${diagnostics.system.platform} (${diagnostics.system.arch})
- **CPU:** ${diagnostics.system.cpuModel} (${diagnostics.system.cpusCount} cores)
- **Memory:** ${diagnostics.memory.usedRAMGB} GB / ${diagnostics.memory.totalRAMGB} GB (${diagnostics.memory.ramUsagePercent}% used)
- **Status:** ${(diagnostics.requirements?.overallStatus || 'UNKNOWN').toUpperCase()}

## Hardware & Acceleration
- **NVIDIA GPU:** ${diagnostics.gpu.hasNvidiaGpu ? `${diagnostics.gpu.gpuName} (CUDA ${diagnostics.gpu.cudaVersion || 'N/A'})` : 'None / CPU Only'}
- **VRAM:** ${diagnostics.gpu.hasNvidiaGpu ? `${diagnostics.gpu.vramUsedMB || 0} / ${diagnostics.gpu.vramTotalMB || 0} MB` : 'N/A'}

## Core Engines
- **Ollama Core:** ${diagnostics.ollama.status.toUpperCase()} (${diagnostics.ollama.url})
  - Installed Models (${diagnostics.ollama.modelsCount}): ${diagnostics.ollama.models.join(', ') || 'None'}
- **Sidecar & LanceDB:** ${diagnostics.sidecar.status.toUpperCase()} ${diagnostics.sidecar.engine ? `(${diagnostics.sidecar.engine})` : ''}

## Recent Diagnostic Logs (${logs.length} entries)
\`\`\`text
${logs.slice(-200).map((l) => `[${l.timestamp}] [${l.level}] [${l.category}]: ${l.message}`).join('\n')}
\`\`\`
`
  }

  const handleCopyReport = async () => {
    const markdown = generateReportMarkdown()
    await navigator.clipboard.writeText(markdown)
    setCopiedReport(true)
    setTimeout(() => setCopiedReport(false), 2500)
  }

  useEffect(() => {
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="diagnostics-drawer-title"
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm transition-opacity animate-in fade-in"
    >
      <div className="w-full max-w-3xl h-full glass-panel border-l border-slate-800 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 id="diagnostics-drawer-title" className="font-semibold text-lg text-slate-100">{t('diagnostics.title')}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-slate-400 font-mono">{t('diagnostics.totalLogs', { count: logs.length })}</span>
                {errorCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-950 text-rose-300 font-bold border border-rose-800/60">
                    {errorCount} ERROR
                  </span>
                )}
                {warnCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 font-bold border border-amber-800/60">
                    {warnCount} WARN
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {cleanMessage && (
              <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2.5 py-1 rounded">
                {cleanMessage}
              </span>
            )}
            <button
              type="button"
              onClick={handleCopyReport}
              aria-label={t('diagnostics.copyReport')}
              className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition-all focus-ring active:scale-95 flex items-center gap-1.5 cursor-pointer"
              title={t('diagnostics.copyReport')}
            >
              {copiedReport ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-cyan-400" />}
              <span>{copiedReport ? t('common.copied') : t('common.copy')}</span>
            </button>

            <div className="group relative flex items-center">
              <button
                type="button"
                onClick={handleCleanResiduals}
                aria-label={t('diagnostics.cleanWorkspace')}
                className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition-all focus-ring active:scale-95 flex items-center gap-1.5 cursor-pointer"
                title={t('diagnostics.cleanWorkspaceHelp') || 'Rimuove i file temporanei e resetta la sessione dell\'agente. I file di codice sorgente non verranno eliminati.'}
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-400" /> {t('diagnostics.cleanWorkspace')}
              </button>
              <div className="absolute right-0 top-full mt-1.5 hidden group-hover:block z-30 w-72 p-2 bg-slate-900 border border-slate-700 rounded-xl shadow-xl text-[10px] text-slate-300 leading-tight">
                {t('diagnostics.cleanWorkspaceHelp') || 'Rimuove i file temporanei e resetta la sessione dell\'agente. I file di codice sorgente non verranno eliminati.'}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors focus-ring active:scale-95 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* System Summary Cards */}
        {diagnostics && (
          <div className="p-4 border-b border-slate-800/80 grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-950/40">
            {/* Python Sidecar & LanceDB Status */}
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{t('diagnostics.sidecarTitle')}</span>
                <span className={`w-2 h-2 rounded-full ${diagnostics.sidecar?.status === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="font-medium text-sm text-slate-200 capitalize">{diagnostics.sidecar?.status || 'offline'}</span>
                {diagnostics.sidecar?.status !== 'online' ? (
                  <button
                    type="button"
                    onClick={handleRestartSidecar}
                    disabled={isRestartingSidecar}
                    className="text-[10px] px-2 py-0.5 rounded bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-300 border border-cyan-500/30 flex items-center gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <RefreshCw className={`w-3 h-3 ${isRestartingSidecar ? 'animate-spin' : ''}`} />
                    {isRestartingSidecar ? 'Starting...' : t('diagnostics.restartSidecar')}
                  </button>
                ) : (
                  diagnostics.sidecar?.version && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono">v{diagnostics.sidecar.version}</span>
                  )
                )}
              </div>
              <span className="text-[11px] text-slate-400 mt-1 truncate font-mono">
                {diagnostics.sidecar?.status === 'online'
                  ? `${diagnostics.sidecar.documentsCount || 0} docs (${diagnostics.sidecar.chunksCount || 0} chunks)`
                  : diagnostics.sidecar?.error || 'Offline'}
              </span>
            </div>

            {/* Ollama Status */}
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{t('diagnostics.ollamaTitle')}</span>
                <Zap className={`w-3.5 h-3.5 ${diagnostics.ollama.status === 'online' ? 'text-emerald-400' : 'text-rose-400'}`} />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${diagnostics.ollama.status === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
                <span className="font-medium text-sm text-slate-200 capitalize">{diagnostics.ollama.status}</span>
              </div>
              <span className="text-[11px] text-slate-400 mt-1 truncate font-mono">
                {diagnostics.ollama.modelsCount} {t('settings.ollamaSection')}
              </span>
            </div>

            {/* GPU / CUDA */}
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{t('diagnostics.gpuTitle')}</span>
                <Cpu className="w-3.5 h-3.5 text-cyan-400" />
              </div>
              <div className="mt-2 text-sm font-medium text-slate-200 overflow-hidden">
                <span className="block truncate" title={diagnostics.gpu.hasNvidiaGpu ? (diagnostics.gpu.gpuName ?? '') : 'CPU Only'}>
                  {diagnostics.gpu.hasNvidiaGpu ? diagnostics.gpu.gpuName : 'CPU Only'}
                </span>
              </div>
              <span className="text-[11px] text-slate-400 mt-1 truncate font-mono">
                {diagnostics.gpu.hasNvidiaGpu
                  ? `VRAM: ${diagnostics.gpu.vramUsedMB}/${diagnostics.gpu.vramTotalMB} MB`
                  : 'CPU'}
              </span>
              {diagnostics.gpu.hasNvidiaGpu && diagnostics.gpu.vramTotalMB ? (
                <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
                  {(() => {
                    const used = diagnostics.gpu.vramUsedMB || 0
                    const total = diagnostics.gpu.vramTotalMB || 1
                    const vramPct = Math.round((used / total) * 100)
                    return (
                      <div
                        className={`h-full transition-all duration-300 ${
                          vramPct > 90 ? 'bg-rose-500' : vramPct > 75 ? 'bg-amber-500' : 'bg-cyan-500'
                        }`}
                        style={{ width: `${Math.min(100, vramPct)}%` }}
                      />
                    )
                  })()}
                </div>
              ) : null}
            </div>

            {/* RAM */}
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{t('diagnostics.ramTitle')}</span>
                <HardDrive className="w-3.5 h-3.5 text-sky-400" />
              </div>
              <div className="mt-2 text-sm font-medium text-slate-200">
                {diagnostics.memory.usedRAMGB} / {diagnostics.memory.totalRAMGB} GB
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    diagnostics.memory.ramUsagePercent > 90
                      ? 'bg-rose-500'
                      : diagnostics.memory.ramUsagePercent > 75
                      ? 'bg-amber-500'
                      : 'bg-cyan-500'
                  }`}
                  style={{ width: `${diagnostics.memory.ramUsagePercent}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Ollama OS Environment Parameters Synthetic Preview & Actions */}
        {envConfig && (
          <div className="border-b border-slate-800 bg-slate-950/70 px-4 py-2.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Zap className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-slate-200 font-semibold text-xs">
                {t('ollamaEnvParams.title')} ({envConfig.profileTier.toUpperCase()}):
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-amber-300 text-[10px] font-mono font-bold">
                {t('ollamaEnvParams.varCount', { count: envConfig.variables.length })}
              </span>
              {applyEnvFeedback && (
                <span
                  className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
                    applyEnvFeedback.success
                      ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                      : 'bg-rose-950/60 text-rose-300 border-rose-800/60'
                  }`}
                >
                  {applyEnvFeedback.message}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => setShowEnvParamsModal(true)}
                className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300 text-xs font-semibold rounded-xl transition-all focus-ring active:scale-95 flex items-center gap-1.5 cursor-pointer"
                title={t('ollamaEnvParams.viewBtnAria')}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>{t('ollamaEnvParams.viewBtn')}</span>
              </button>
            </div>
          </div>
        )}

        {/* Toolbar & Filters */}
        <div className="p-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2.5 bg-slate-900/40">
          <input
            type="text"
            aria-label={t('diagnostics.filterPlaceholder')}
            placeholder={t('diagnostics.filterPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 min-w-[150px] bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-1.5 text-xs text-slate-200 focus-ring outline-none"
          />

          {/* Level Filter */}
          <select
            aria-label="Filter logs by level"
            value={selectedLevel}
            onChange={(e) => setSelectedLevel(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus-ring outline-none font-mono"
          >
            <option value="ALL">{t('diagnostics.allLevels')}</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
            <option value="DEBUG">DEBUG</option>
          </select>

          {/* Category Filter */}
          {categories.length > 0 && (
            <select
              aria-label="Filter logs by category"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus-ring outline-none font-mono max-w-[140px]"
            >
              <option value="ALL">{t('diagnostics.allCategories')}</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          )}

          {/* Auto-scroll toggle */}
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded bg-slate-950 border-slate-800 text-cyan-500 focus:ring-0"
            />
            <span>{t('diagnostics.autoScroll')}</span>
          </label>

          <button
            type="button"
            onClick={fetchLogs}
            disabled={isRefreshingLogs}
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs transition-all focus-ring active:scale-95 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingLogs ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={async () => {
              await apiService.openLogsFolder()
            }}
            title={t('diagnostics.openLogsFolder')}
            aria-label={t('diagnostics.openLogsFolder')}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded-xl text-xs transition-all focus-ring active:scale-95 flex items-center gap-1"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleClear}
            title={t('diagnostics.clearLogs')}
            aria-label={t('diagnostics.clearLogs')}
            className="p-2 bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 border border-rose-800/40 rounded-xl text-xs transition-all focus-ring active:scale-95 flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Log Viewer Console */}
        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-2 bg-slate-950/90" tabIndex={0} aria-label="System logs">
          {filteredLogs.length === 0 ? (
            <div className="text-center py-12 text-slate-400 font-sans text-xs">
              {t('common.none')}
            </div>
          ) : (
            filteredLogs.map((log, index) => (
              <div
                key={index}
                className="flex items-start gap-2 p-1.5 hover:bg-slate-900/50 rounded-lg transition-colors"
              >
                <span className="text-slate-400 shrink-0 text-[10px] font-mono">
                  {!isNaN(Date.parse(log.timestamp)) ? new Date(log.timestamp).toLocaleTimeString() : log.timestamp || '—'}
                </span>

                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                    log.level === 'ERROR'
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      : log.level === 'WARN'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      : log.level === 'DEBUG'
                      ? 'bg-slate-800 text-slate-300 border border-slate-700'
                      : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                  }`}
                >
                  {log.level}
                </span>

                <span className="text-slate-300 font-semibold shrink-0">[{log.category}]</span>
                <span className="text-slate-200 break-all">{log.message}</span>
              </div>
            ))
          )}
          <div ref={consoleBottomRef} />
        </div>

        {/* Footer */}
        {logPath && (
          <div className="p-2 border-t border-slate-800 bg-slate-950 text-[11px] text-slate-400 truncate text-center">
            {t('diagnostics.logFile')}: <span className="text-slate-400 select-all font-mono">{logPath}</span>
          </div>
        )}
      </div>

      {envConfig && (
        <>
          <OllamaEnvParamsModal
            isOpen={showEnvParamsModal}
            onClose={() => setShowEnvParamsModal(false)}
            envConfig={envConfig}
            onOpenApprovalModal={() => setShowApprovalModal(true)}
          />
          <OllamaEnvApprovalModal
            isOpen={showApprovalModal}
            onClose={() => setShowApprovalModal(false)}
            envConfig={envConfig}
            restartOllamaAfterApply={restartOllamaAfterApply}
            onChangeRestartOllamaAfterApply={setRestartOllamaAfterApply}
            isApplyingEnvVars={isApplyingEnvVars}
            onApply={handleApplyEnvVars}
          />
        </>
      )}
    </div>
  )
}
