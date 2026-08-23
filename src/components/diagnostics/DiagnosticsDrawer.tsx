import React, { useState, useEffect, useRef } from 'react'
import { Modal } from '../common/Modal'
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
  Search,
  AlertTriangle,
  AlertCircle,
  WrapText,
  ArrowDownCircle,
} from 'lucide-react'
import { useTranslation } from '../../i18n'

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
  const [autoScroll, setAutoScroll] = useState<boolean>(true)
  const [isWordWrap, setIsWordWrap] = useState<boolean>(true)
  const [isRestartingSidecar, setIsRestartingSidecar] = useState<boolean>(false)
  const consoleBottomRef = useRef<HTMLDivElement | null>(null)

  const fetchLogs = async () => {
    setIsRefreshingLogs(true)
    try {
      const fetchedLogs = await apiService.getLogs()
      let pathStr = ''
      if (window.electronAPI?.getLogFilePath) {
        pathStr = await window.electronAPI.getLogFilePath()
      }
      setLogs(fetchedLogs)
      setLogPath(pathStr)
    } finally {
      setIsRefreshingLogs(false)
    }
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

  const handleRestartSidecar = async () => {
    if (window.electronAPI?.restartSidecar) {
      setIsRestartingSidecar(true)
      try {
        await window.electronAPI.restartSidecar()
        onRefreshDiagnostics()
      } finally {
        setIsRestartingSidecar(false)
      }
    }
  }

  const handleClear = async () => {
    if (window.electronAPI?.clearLogs) {
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
      !searchQuery ||
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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      labelledById="diagnostics-drawer-title"
      align="end"
      panelClassName="max-w-3xl h-full glass-panel border-l border-slate-800 flex flex-col shadow-2xl bg-slate-950"
    >
        {/* Top Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
              <Terminal className="w-4.5 h-4.5 text-cyan-400" />
            </div>
            <div>
              <h2 id="diagnostics-drawer-title" className="font-bold text-base text-slate-100 flex items-center gap-2">
                {t('diagnostics.title')}
              </h2>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400 font-mono">
                <span>{t('diagnostics.totalLogs', { count: logs.length })}</span>
                {errorCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded bg-rose-950/80 text-rose-300 text-[10px] font-bold border border-rose-800/60 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {errorCount} ERR
                  </span>
                )}
                {warnCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded bg-amber-950/80 text-amber-300 text-[10px] font-bold border border-amber-800/60 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {warnCount} WARN
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyReport}
              aria-label={t('diagnostics.copyReport')}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-cyan-500/50 text-slate-200 text-xs font-semibold rounded-xl transition-all focus-ring active:scale-95 flex items-center gap-1.5 shadow-sm"
              title={t('diagnostics.copyReport')}
            >
              {copiedReport ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-cyan-400" />}
              <span>{copiedReport ? t('common.copied') : t('diagnostics.copyReport')}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-xl transition-colors focus-ring active:scale-95"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Compact Telemetry & Health Grid */}
        {diagnostics && (
          <div className="p-4 border-b border-slate-800/80 grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-900/40">
            {/* Python Sidecar & LanceDB Status */}
            <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col justify-between space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-semibold text-slate-300">{t('diagnostics.sidecarTitle')}</span>
                <span className={`w-2 h-2 rounded-full ${diagnostics.sidecar?.status === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
              </div>
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-slate-100 uppercase font-mono">{diagnostics.sidecar?.status || 'offline'}</span>
                {diagnostics.sidecar?.status !== 'online' ? (
                  <button
                    type="button"
                    onClick={handleRestartSidecar}
                    disabled={isRestartingSidecar}
                    className="text-[10px] px-2 py-0.5 rounded bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-300 border border-cyan-500/30 flex items-center gap-1 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-2.5 h-2.5 ${isRestartingSidecar ? 'animate-spin' : ''}`} />
                    <span>{isRestartingSidecar ? '...' : t('diagnostics.restartSidecar')}</span>
                  </button>
                ) : (
                  diagnostics.sidecar?.version && (
                    <span className="text-[10px] font-mono text-cyan-400">v{diagnostics.sidecar.version}</span>
                  )
                )}
              </div>
              <p className="text-[10px] text-slate-400 font-mono truncate">
                {diagnostics.sidecar?.status === 'online'
                  ? `${diagnostics.sidecar.documentsCount || 0} docs / ${diagnostics.sidecar.chunksCount || 0} chunks`
                  : 'FastAPI offline'}
              </p>
            </div>

            {/* Ollama Status */}
            <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col justify-between space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-semibold text-slate-300">{t('diagnostics.ollamaTitle')}</span>
                <Zap className={`w-3.5 h-3.5 ${diagnostics.ollama.status === 'online' ? 'text-emerald-400' : 'text-rose-400'}`} />
              </div>
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-slate-100 uppercase font-mono">{diagnostics.ollama.status}</span>
                <span className="text-[10px] font-mono text-emerald-400">{diagnostics.ollama.modelsCount} models</span>
              </div>
              <p className="text-[10px] text-slate-400 font-mono truncate">
                {diagnostics.ollama.url}
              </p>
            </div>

            {/* GPU / VRAM */}
            <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col justify-between space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-semibold text-slate-300">{t('diagnostics.gpuTitle')}</span>
                <Cpu className="w-3.5 h-3.5 text-cyan-400" />
              </div>
              <div className="text-xs font-bold text-slate-100 truncate" title={diagnostics.gpu.hasNvidiaGpu ? (diagnostics.gpu.gpuName ?? '') : 'CPU Only'}>
                {diagnostics.gpu.hasNvidiaGpu ? diagnostics.gpu.gpuName : 'CPU Host'}
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-mono text-slate-400">
                  <span>VRAM</span>
                  <span className="text-cyan-300">
                    {diagnostics.gpu.hasNvidiaGpu && diagnostics.gpu.vramTotalMB
                      ? `${diagnostics.gpu.vramUsedMB || 0} / ${diagnostics.gpu.vramTotalMB} MB`
                      : 'N/A'}
                  </span>
                </div>
                {diagnostics.gpu.hasNvidiaGpu && diagnostics.gpu.vramTotalMB && (
                  <div className="w-full bg-slate-950 h-1 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        (diagnostics.gpu.vramUsedMB || 0) / diagnostics.gpu.vramTotalMB > 0.85 ? 'bg-rose-500' : 'bg-cyan-500'
                      }`}
                      style={{ width: `${Math.min(100, Math.round(((diagnostics.gpu.vramUsedMB || 0) / diagnostics.gpu.vramTotalMB) * 100))}%` }}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* RAM */}
            <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col justify-between space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-semibold text-slate-300">{t('diagnostics.ramTitle')}</span>
                <HardDrive className="w-3.5 h-3.5 text-sky-400" />
              </div>
              <div className="text-xs font-bold text-slate-100">
                {diagnostics.memory.usedRAMGB} / {diagnostics.memory.totalRAMGB} GB
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-mono text-slate-400">
                  <span>Uso</span>
                  <span className="text-sky-300">{diagnostics.memory.ramUsagePercent}%</span>
                </div>
                <div className="w-full bg-slate-950 h-1 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      diagnostics.memory.ramUsagePercent > 85 ? 'bg-amber-500' : 'bg-sky-500'
                    }`}
                    style={{ width: `${diagnostics.memory.ramUsagePercent}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Search & Filter Toolbar */}
        <div className="p-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2.5 bg-slate-900/60">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              aria-label={t('diagnostics.filterPlaceholder')}
              placeholder={t('diagnostics.filterPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 focus-ring outline-none font-mono placeholder:font-sans"
            />
          </div>

          {/* Level Filter Dropdown */}
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

          {/* Category Filter Dropdown */}
          {categories.length > 0 && (
            <select
              aria-label="Filter logs by category"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus-ring outline-none font-mono max-w-[130px]"
            >
              <option value="ALL">{t('diagnostics.allCategories')}</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-1.5">
            {/* AutoScroll Toggle Button */}
            <button
              type="button"
              onClick={() => setAutoScroll(!autoScroll)}
              title={t('diagnostics.autoScroll')}
              className={`p-2 rounded-xl text-xs font-semibold transition-all focus-ring active:scale-95 flex items-center gap-1 ${
                autoScroll
                  ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-800/60'
                  : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <ArrowDownCircle className="w-3.5 h-3.5" />
            </button>

            {/* WordWrap Toggle Button */}
            <button
              type="button"
              onClick={() => setIsWordWrap(!isWordWrap)}
              title={t('settings.wordWrap')}
              className={`p-2 rounded-xl text-xs font-semibold transition-all focus-ring active:scale-95 flex items-center gap-1 ${
                isWordWrap
                  ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-800/60'
                  : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <WrapText className="w-3.5 h-3.5" />
            </button>

            {/* Refresh Logs Button */}
            <button
              type="button"
              onClick={fetchLogs}
              disabled={isRefreshingLogs}
              title={t('common.refresh')}
              aria-label={t('common.refresh')}
              className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded-xl text-xs transition-all focus-ring active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingLogs ? 'animate-spin' : ''}`} />
            </button>

            {/* Open Logs Folder Button */}
            <button
              type="button"
              onClick={async () => {
                await apiService.openLogsFolder()
              }}
              title={t('diagnostics.openLogsFolder')}
              aria-label={t('diagnostics.openLogsFolder')}
              className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-400 rounded-xl text-xs transition-all focus-ring active:scale-95"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>

            {/* Clear Logs Button */}
            <button
              type="button"
              onClick={handleClear}
              title={t('diagnostics.clearLogs')}
              aria-label={t('diagnostics.clearLogs')}
              className="p-2 bg-slate-900 hover:bg-rose-950/80 border border-slate-700 hover:border-rose-700 text-slate-400 hover:text-rose-300 rounded-xl text-xs transition-all focus-ring active:scale-95"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Real-time Log Stream Console */}
        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1.5 bg-slate-950" tabIndex={0} aria-label="System logs stream">
          {filteredLogs.length === 0 ? (
            <div className="text-center py-16 text-slate-500 font-sans text-xs">
              {t('common.none')}
            </div>
          ) : (
            filteredLogs.map((log, index) => (
              <div
                key={index}
                className="flex items-start gap-2 py-1 px-2 hover:bg-slate-900/60 rounded-lg transition-colors leading-relaxed"
              >
                <span className="text-slate-500 shrink-0 text-[10px] font-mono select-none">
                  {!isNaN(Date.parse(log.timestamp)) ? new Date(log.timestamp).toLocaleTimeString() : log.timestamp || '—'}
                </span>

                <span
                  className={`px-1.5 py-0.2 rounded text-[10px] font-bold shrink-0 font-mono ${
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

                <span className="text-slate-400 font-semibold shrink-0 font-mono text-[11px]">[{log.category}]</span>
                <span className={`text-slate-200 ${isWordWrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre overflow-x-auto'}`}>{log.message}</span>
              </div>
            ))
          )}
          <div ref={consoleBottomRef} />
        </div>

        {/* Compact Footer with Log File Path */}
        {logPath && (
          <div className="px-4 py-2 border-t border-slate-800 bg-slate-900/80 text-[11px] text-slate-400 flex items-center justify-between">
            <span className="text-slate-400 truncate">
              {t('diagnostics.logFile')}: <span className="font-mono text-slate-300 select-all">{logPath}</span>
            </span>
          </div>
        )}
    </Modal>
  )
}
