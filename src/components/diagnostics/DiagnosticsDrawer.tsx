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
  Download,
  Filter,
  FolderOpen,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import {
  getRecommendedOllamaEnvVars,
  OllamaEnvConfig,
} from '../../services/hardwareRecommendationEngine'

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
  const [copiedEnvScript, setCopiedEnvScript] = useState<string | null>(null)
  const [showEnvConfig, setShowEnvConfig] = useState<boolean>(false)
  const [showApprovalModal, setShowApprovalModal] = useState<boolean>(false)
  const [isApplyingEnvVars, setIsApplyingEnvVars] = useState<boolean>(false)
  const [restartOllamaAfterApply, setRestartOllamaAfterApply] = useState<boolean>(true)
  const [applyEnvFeedback, setApplyEnvFeedback] = useState<{ success: boolean; message: string } | null>(null)
  const [autoScroll, setAutoScroll] = useState<boolean>(false)
  const consoleBottomRef = useRef<HTMLDivElement | null>(null)

  const envConfig: OllamaEnvConfig | null = diagnostics ? getRecommendedOllamaEnvVars(diagnostics) : null

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

  const handleApplyEnvVars = async () => {
    if (!envConfig || envConfig.variables.length === 0) return
    setIsApplyingEnvVars(true)
    try {
      const res = await apiService.applyOllamaEnvironmentVariables(
        envConfig.variables.map((v) => ({ name: v.name, value: v.value })),
        restartOllamaAfterApply
      )
      setApplyEnvFeedback({
        success: res.success,
        message: res.message || (res.success ? 'Variabili applicate con successo!' : "Errore durante l'applicazione"),
      })
      setShowApprovalModal(false)
      onRefreshDiagnostics()
    } catch (err: any) {
      setApplyEnvFeedback({
        success: false,
        message: `Errore: ${err.message}`,
      })
    } finally {
      setIsApplyingEnvVars(false)
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

  const handleExportReport = () => {
    const markdown = generateReportMarkdown()
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `onlyrag_diagnostics_${new Date().toISOString().replace(/[:.]/g, '-')}.md`
    a.click()
    URL.revokeObjectURL(url)
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
              onClick={handleCopyReport}
              aria-label={t('diagnostics.copyReport')}
              className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition-all focus-ring active:scale-95 flex items-center gap-1.5"
              title={t('diagnostics.copyReport')}
            >
              {copiedReport ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-cyan-400" />}
              <span>{copiedReport ? t('common.copied') : t('common.copy')}</span>
            </button>
            <button
              onClick={handleExportReport}
              aria-label={t('diagnostics.exportReport')}
              className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition-all focus-ring active:scale-95 flex items-center gap-1.5"
              title={t('diagnostics.exportReport')}
            >
              <Download className="w-3.5 h-3.5 text-sky-400" /> {t('common.export')}
            </button>
            <button
              onClick={handleCleanResiduals}
              aria-label={t('diagnostics.cleanWorkspace')}
              className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition-all focus-ring active:scale-95 flex items-center gap-1.5"
              title={t('diagnostics.cleanWorkspace')}
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" /> {t('diagnostics.cleanWorkspace')}
            </button>
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors focus-ring active:scale-95"
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
                    onClick={handleRestartSidecar}
                    disabled={isRestartingSidecar}
                    className="text-[10px] px-2 py-0.5 rounded bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-300 border border-cyan-500/30 flex items-center gap-1 transition-colors"
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
              <span className="text-[11px] text-slate-500 mt-1 truncate font-mono">
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

        {/* Ollama OS Environment Parameters & Script */}
        {envConfig && (
          <div className="border-b border-slate-800 bg-slate-950/70">
            <div className="px-4 py-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs">
                <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="text-slate-200 font-semibold text-xs">Parametri OS Client Ollama ({envConfig.profileTier.toUpperCase()}):</span>
                <span className="text-slate-400 font-mono text-[11px] hidden sm:inline truncate max-w-xs">
                  {envConfig.variables.slice(0, 3).map((v) => `${v.name}=${v.value}`).join(' | ')}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowEnvConfig(!showEnvConfig)}
                  className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300 text-[11px] font-semibold rounded-lg transition-all focus-ring active:scale-95"
                >
                  {showEnvConfig ? 'Nascondi' : 'Dettagli OS'}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(envConfig.powershellScript)
                    setCopiedEnvScript('ps')
                    setTimeout(() => setCopiedEnvScript(null), 2500)
                  }}
                  className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-[11px] font-semibold rounded-lg transition-all focus-ring flex items-center gap-1 active:scale-95"
                  title="Copia script PowerShell per impostare le variabili d'ambiente OS utente"
                >
                  {copiedEnvScript === 'ps' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedEnvScript === 'ps' ? 'Copiato!' : 'Copia PowerShell'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowApprovalModal(true)}
                  className="px-2.5 py-1 bg-gradient-to-r from-amber-500/20 to-cyan-500/20 hover:from-amber-500/30 hover:to-cyan-500/30 text-amber-300 border border-amber-500/50 text-[11px] font-bold rounded-lg transition-all focus-ring flex items-center gap-1.5 active:scale-95 shadow-sm"
                  title="Applica le variabili d'ambiente al sistema operativo (richiede conferma)"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                  <span>Applica all'OS...</span>
                </button>
              </div>
            </div>

            {applyEnvFeedback && (
              <div
                className={`mx-4 my-2 p-2.5 rounded-lg border text-xs flex items-center justify-between ${
                  applyEnvFeedback.success
                    ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-300'
                    : 'bg-rose-950/60 border-rose-800/80 text-rose-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  {applyEnvFeedback.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  )}
                  <span>{applyEnvFeedback.message}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setApplyEnvFeedback(null)}
                  className="p-1 hover:bg-slate-800/60 rounded text-slate-400 hover:text-slate-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {showEnvConfig && (
              <div className="p-4 border-t border-slate-800/80 bg-slate-950 space-y-3 max-h-60 overflow-y-auto">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-amber-300 flex items-center gap-1.5">
                    ⚡ Variabili d'Ambiente Consigliate per il tuo Hardware
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 font-mono">
                    Profilo: {envConfig.profileTier.toUpperCase()}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                  {envConfig.variables.map((v) => (
                    <div key={v.name} className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1">
                      <div className="flex items-center justify-between font-mono">
                        <strong className="text-cyan-300 text-[11px]">{v.name}</strong>
                        <span className="px-1.5 py-0.2 rounded bg-slate-950 text-amber-300 font-bold border border-slate-800 text-[10px]">
                          {v.value}
                        </span>
                      </div>
                      <p className="text-slate-300 text-[10px] leading-tight">{v.description}</p>
                      <p className="text-slate-500 text-[9px] italic">{v.rationale}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
            onClick={fetchLogs}
            disabled={isRefreshingLogs}
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs transition-all focus-ring active:scale-95 flex items-center gap-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingLogs ? 'animate-spin' : ''}`} />
          </button>

          <button
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
            <div className="text-center py-12 text-slate-500 font-sans text-xs">
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
          <div className="p-2 border-t border-slate-800 bg-slate-950 text-[11px] text-slate-500 truncate text-center">
            {t('diagnostics.logFile')}: <span className="text-slate-400 select-all font-mono">{logPath}</span>
          </div>
        )}
      </div>

      {/* User Approval Modal for Environment Variables */}
      {showApprovalModal && envConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-100 text-sm">Richiesta di Approvazione Utente</h3>
                  <p className="text-[11px] text-slate-400">Applicazione Variabili d'Ambiente Ollama OS</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowApprovalModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto text-xs">
              <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-800/40 text-amber-200/90 leading-relaxed text-[11px]">
                Le seguenti variabili d'ambiente verranno impostate in modo persistente nel profilo utente del sistema operativo (Windows User Environment) per ottimizzare l'allocazione VRAM, la velocità di inferenza (Flash Attention) e la concorrenza di Ollama per il profilo hardware <strong>{envConfig.profileTier.toUpperCase()}</strong>:
              </div>

              <div className="space-y-2 font-mono">
                {envConfig.variables.map((v) => (
                  <div key={v.name} className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-cyan-300 text-[11px]">{v.name}</span>
                      <span className="px-2 py-0.5 rounded bg-slate-900 text-amber-300 font-bold border border-slate-700 text-[10px]">
                        {v.value}
                      </span>
                    </div>
                    <p className="text-slate-400 font-sans text-[10px]">{v.description} — <span className="italic text-slate-500">{v.rationale}</span></p>
                  </div>
                ))}
              </div>

              <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
                <input
                  type="checkbox"
                  checked={restartOllamaAfterApply}
                  onChange={(e) => setRestartOllamaAfterApply(e.target.checked)}
                  className="rounded border-slate-700 text-cyan-500 focus:ring-cyan-500 h-4 w-4 bg-slate-900"
                />
                <span className="text-[11px] text-slate-300">
                  Riavvia automaticamente l'applicazione Ollama per rendere attive le modifiche immediatamente
                </span>
              </label>
            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-950/80 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowApprovalModal(false)}
                disabled={isApplyingEnvVars}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-colors"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={handleApplyEnvVars}
                disabled={isApplyingEnvVars}
                className="px-4 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-bold rounded-xl text-xs transition-all shadow-md flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
              >
                {isApplyingEnvVars ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Applicazione in corso...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Approva e Applica</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
