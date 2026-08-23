import React, { useState, useRef, useEffect } from 'react'
import {
  ChevronDown,
  Check,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { isOllamaModelInstalled } from '../../services/hardwareRecommendationEngine'
import {
  type ModelIntent,
  filterModelsByIntent,
  isModelForIntent,
} from '../../services/modelIntentClassifier'

export interface QuickModelSelectorProps {
  /** Currently active model name for this functional feature */
  currentModel: string
  /** Fallback model name (optional) */
  fallbackModel?: string
  /** List of all installed model tags in local Ollama instance */
  installedModels?: string[]
  /** Curated preset model options for this specific feature */
  presetOptions?: string[]
  /** Functional intent to filter compatible models (e.g. 'vision', 'coding', 'chat', 'translation') */
  intent?: ModelIntent
  /** Callback triggered when user selects a new active model */
  onSelectModel: (modelName: string) => void
  /** Optional callback to configure or change fallback model */
  onSelectFallbackModel?: (fallbackModelName?: string) => void
  /** Module icon component or visual theme */
  icon?: React.ElementType
  /** Feature label for accessibility and tooltips (e.g. 'Coding', 'Chat', 'Translation') */
  featureLabel: string
  /** Visual variant styling */
  variant?: 'cyan' | 'purple' | 'sky' | 'emerald' | 'amber'
  /** Optional extra CSS classes */
  className?: string
  /** Disable interaction */
  disabled?: boolean
}

export const QuickModelSelector: React.FC<QuickModelSelectorProps> = ({
  currentModel,
  fallbackModel,
  installedModels = [],
  presetOptions = [],
  intent,
  onSelectModel,
  onSelectFallbackModel,
  icon: IconComponent = Sparkles,
  featureLabel,
  variant = 'cyan',
  className = '',
  disabled = false,
}) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const isInstalled = isOllamaModelInstalled(currentModel, installedModels)

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Filter installed models and build candidate list by intent if specified
  const filteredInstalledModels = intent
    ? installedModels.filter((m) => isModelForIntent(m, intent))
    : installedModels

  const allCandidateModels = intent
    ? filterModelsByIntent(installedModels, intent, {
        includeCurrent: currentModel,
        includeFallback: fallbackModel,
        presetOptions,
      })
    : Array.from(
        new Set([
          currentModel,
          ...(fallbackModel ? [fallbackModel] : []),
          ...presetOptions,
          ...installedModels,
        ].filter((m): m is string => Boolean(m && typeof m === 'string' && m.trim().length > 0)))
      )

  const variantStyles = {
    cyan: 'bg-cyan-950/60 border-cyan-500/40 text-cyan-200 hover:bg-cyan-900/60 hover:border-cyan-500/60',
    purple: 'bg-purple-950/60 border-purple-500/40 text-purple-200 hover:bg-purple-900/60 hover:border-purple-500/60',
    sky: 'bg-sky-950/60 border-sky-500/40 text-sky-200 hover:bg-sky-900/60 hover:border-sky-500/60',
    emerald: 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200 hover:bg-emerald-900/60 hover:border-emerald-500/60',
    amber: 'bg-amber-950/60 border-amber-500/40 text-amber-200 hover:bg-amber-900/60 hover:border-amber-500/60',
  }

  const activeStyle = variantStyles[variant] || variantStyles.cyan

  return (
    <div className={`relative inline-block text-left ${className}`} ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`${featureLabel}: ${currentModel}${fallbackModel ? ` (Fallback: ${fallbackModel})` : ''}`}
        title={`${featureLabel}: ${currentModel}${fallbackModel ? ` • Fallback: ${fallbackModel}` : ''}`}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono font-semibold border transition-all focus-ring shadow-sm ${activeStyle} ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer active:scale-95'
        }`}
      >
        <IconComponent className="w-3.5 h-3.5 shrink-0 text-current opacity-90" />
        <span className="truncate max-w-[140px] font-bold">{currentModel || 'Seleziona'}</span>

        {/* Status indicator dot */}
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            isInstalled ? 'bg-emerald-400 shadow-sm shadow-emerald-500/80' : 'bg-amber-400'
          }`}
          title={isInstalled ? t('common.ready') : t('common.download')}
        />

        {fallbackModel && (
          <span className="text-[9px] px-1 py-0.2 rounded bg-slate-900/80 text-slate-300 font-sans border border-slate-700/60 hidden md:inline">
            🛡️ {fallbackModel.split(':')[0]}
          </span>
        )}

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
              {filteredInstalledModels.length} {t('common.ready').toLowerCase()}
            </span>
          </div>

          {/* Model Options List */}
          <div className="max-h-60 overflow-y-auto py-1 space-y-0.5 custom-scrollbar">
            {allCandidateModels.map((modelName) => {
              const installed = isOllamaModelInstalled(modelName, installedModels)
              const isSelected = modelName === currentModel
              const isFallback = modelName === fallbackModel

              return (
                <button
                  key={modelName}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onSelectModel(modelName)
                    setIsOpen(false)
                  }}
                  className={`w-full px-3 py-1.5 text-left text-xs font-mono flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-cyan-950/80 text-cyan-200 font-bold'
                      : 'text-slate-300 hover:bg-slate-900 hover:text-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {isSelected ? (
                      <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    ) : (
                      <span className="w-3.5 shrink-0" />
                    )}
                    <span className="truncate" title={modelName}>{modelName}</span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isFallback && (
                      <span className="text-[9px] font-sans px-1 py-0.2 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60">
                        Fallback
                      </span>
                    )}
                    <span
                      className={`text-[10px] font-sans px-1.5 py-0.5 rounded ${
                        installed
                          ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/40'
                          : 'bg-slate-900 text-slate-500 border border-slate-800'
                      }`}
                    >
                      {installed ? '✓' : '⬇'}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Fallback configuration footer if supported */}
          {onSelectFallbackModel && (
            <div className="px-3 py-2 bg-slate-900/40 space-y-1.5 font-sans">
              <div className="flex items-center justify-between text-[11px] gap-2">
                <span className="text-slate-400 flex items-center gap-1 shrink-0">
                  <ShieldAlert className="w-3 h-3 text-amber-400" /> Fallback OOM:
                </span>
                <select
                  value={fallbackModel || ''}
                  onChange={(e) => onSelectFallbackModel(e.target.value || undefined)}
                  className="bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-[10px] text-slate-200 font-mono max-w-[130px] truncate focus-ring"
                >
                  <option value="">(Disattivato)</option>
                  {allCandidateModels
                    .filter((m) => m !== currentModel)
                    .map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
