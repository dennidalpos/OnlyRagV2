import React, { useState, useRef, useEffect } from 'react'
import {
  ChevronDown,
  Check,
  Sparkles,
  Loader2,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useModelDownloadProgress } from '../../hooks/useModelDownloadProgress'
import { isOllamaModelInstalled } from '../../services/hardwareRecommendationEngine'
import { buildOllamaModelOptions } from '../../services/ollamaModelOptions'

export interface QuickModelSelectorProps {
  /** Currently active model name for this functional feature */
  currentModel: string
  /** List of all installed model tags in local Ollama instance */
  installedModels?: string[]
  /** Callback triggered when user selects a new active model */
  onSelectModel: (modelName: string) => void
  /** Module icon component or visual theme */
  icon?: React.ElementType
  /** Feature label for accessibility and tooltips (e.g. 'Coding', 'Chat', 'Translation') */
  featureLabel: string
  /** Optional extra CSS classes */
  className?: string
  /** Disable interaction */
  disabled?: boolean
}

export const QuickModelSelector: React.FC<QuickModelSelectorProps> = ({
  currentModel,
  installedModels = [],
  onSelectModel,
  icon: IconComponent = Sparkles,
  featureLabel,
  className = '',
  disabled = false,
}) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const downloadProgress = useModelDownloadProgress()

  const isInstalled = isOllamaModelInstalled(currentModel, installedModels)
  const isCurrentModelUpdating = downloadProgress.isDownloading && downloadProgress.modelName === currentModel

  // Close on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const allCandidateModels = buildOllamaModelOptions(installedModels, currentModel)

  return (
    <div className={`relative inline-block text-left ${className}`} ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`${featureLabel}: ${currentModel || 'Seleziona'}`}
        title={`${featureLabel}: ${currentModel || 'Seleziona'}${isCurrentModelUpdating ? ` • (${t('settings.updating')})` : ''}`}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono font-semibold border transition-all focus-ring shadow-sm ${
          isCurrentModelUpdating
            ? 'bg-amber-950/70 border-amber-500/60 text-amber-200 ring-1 ring-amber-500/50 animate-pulse'
            : 'bg-slate-900/80 border-slate-700 text-slate-200 hover:bg-slate-800 hover:border-slate-500'
        } ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer active:scale-95'
        }`}
      >
        {isCurrentModelUpdating ? (
          <Loader2 className="w-3.5 h-3.5 shrink-0 text-amber-400 animate-spin" />
        ) : (
          <IconComponent className="w-3.5 h-3.5 shrink-0 text-current opacity-90" />
        )}
        <span className="truncate max-w-[140px] font-bold">{currentModel || 'Seleziona'}</span>

        {/* Status indicator dot */}
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            isCurrentModelUpdating
              ? 'bg-amber-400 animate-ping'
              : isInstalled
              ? 'bg-emerald-400 shadow-sm shadow-emerald-500/80'
              : 'bg-amber-400'
          }`}
          title={isCurrentModelUpdating ? t('settings.updating') : isInstalled ? t('common.ready') : t('common.download')}
        />

        <ChevronDown className={`w-3 h-3 transition-transform text-current opacity-70 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          role="listbox"
          aria-label={`Lista modelli ${featureLabel}`}
          className="absolute right-0 mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-xl bg-slate-950 border border-slate-800 shadow-2xl shadow-black/80 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 divide-y divide-slate-800/60 overflow-hidden"
        >
          {/* Header */}
          <div className="px-3 py-1.5 text-[11px] font-sans text-slate-400 flex items-center justify-between">
            <span className="font-bold text-slate-200">{featureLabel}</span>
            <span className="text-[10px] text-slate-500 font-mono">
              {installedModels.length} {t('common.ready').toLowerCase()}
            </span>
          </div>

          {/* Model Options List */}
          <div className="max-h-60 overflow-y-auto py-1 space-y-0.5 custom-scrollbar">
            {allCandidateModels.map((modelName) => {
              const installed = isOllamaModelInstalled(modelName, installedModels)
              const isSelected = modelName === currentModel
              const isOptionUpdating = downloadProgress.isDownloading && downloadProgress.modelName === modelName

              return (
                <button
                  key={modelName}
                  type="button"
                  role="option"
                  disabled={isOptionUpdating}
                  aria-selected={isSelected}
                  title={isOptionUpdating ? t('settings.modelUpdatingBlocked') : modelName}
                  onClick={() => {
                    if (isOptionUpdating) return
                    onSelectModel(modelName)
                    setIsOpen(false)
                  }}
                  className={`w-full px-3 py-1.5 text-left text-xs font-mono flex items-center justify-between gap-2 transition-colors ${
                    isOptionUpdating
                      ? 'opacity-60 cursor-not-allowed bg-amber-950/20 text-amber-300'
                      : isSelected
                      ? 'bg-cyan-950/80 text-cyan-200 font-bold cursor-pointer'
                      : 'text-slate-300 hover:bg-slate-900 hover:text-slate-100 cursor-pointer'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {isOptionUpdating ? (
                      <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                    ) : isSelected ? (
                      <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    ) : (
                      <span className="w-3.5 shrink-0" />
                    )}
                    <span className="truncate" title={modelName}>{modelName}</span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isOptionUpdating ? (
                      <span className="text-[9px] font-sans px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-700/60">
                        {downloadProgress.percent}%
                      </span>
                    ) : (
                      <span
                        className={`text-[10px] font-sans px-1.5 py-0.5 rounded ${
                          installed
                            ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/40'
                            : 'bg-slate-900 text-slate-500 border border-slate-800'
                        }`}
                      >
                        {installed ? '✓' : '⬇'}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

        </div>
      )}
    </div>
  )
}
