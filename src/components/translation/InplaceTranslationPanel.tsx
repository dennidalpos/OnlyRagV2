import React from 'react'
import {
  FileCheck2,
  Folder,
  ArrowLeftRight,
  Play,
  Loader2,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Info,
  X,
  FileText,
} from 'lucide-react'
import { AppSettings } from '../../types'
import { useInplaceTranslation, LANGUAGES } from '../../hooks/useTranslation'
import { useTranslation } from '../../i18n'

interface InplaceTranslationPanelProps {
  settings?: AppSettings
  onUpdateSettings?: (newSettings: Partial<AppSettings>) => void
}

export const InplaceTranslationPanel: React.FC<InplaceTranslationPanelProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const { t } = useTranslation()
  const inp = useInplaceTranslation(settings)

  const isFormValid =
    Boolean(inp.selectedDoc) &&
    Boolean(inp.targetDir.trim()) &&
    inp.sourceLang !== inp.targetLang &&
    !inp.isTranslating

  const progressPercent = inp.translateProgress?.percent ?? 0
  const currentPhase = inp.translateProgress?.phase

  const phaseLabel =
    currentPhase === 'extracting_blocks'
      ? t('translation.inplacePhaseExtracting')
      : currentPhase === 'translating_blocks'
        ? t('translation.inplacePhaseTranslatingBlocks')
        : currentPhase === 'reconstructing_layout'
          ? t('translation.inplacePhaseReconstructing')
          : currentPhase === 'translating_runs'
            ? t('translation.inplacePhaseTranslatingRuns')
            : t('translation.inplaceTranslating')

  return (
    <div className="flex-1 h-full overflow-y-auto p-6 bg-slate-950 select-text">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Banner Explainer Card */}
        <div className="p-5 rounded-2xl bg-gradient-to-r from-sky-950/40 via-indigo-950/30 to-slate-900/60 border border-sky-800/40 shadow-xl">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center shrink-0 mt-0.5">
              <FileCheck2 className="w-5 h-5 text-sky-400" />
            </div>
            <div className="space-y-1 min-w-0">
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>{t('translation.inplaceTitle')}</span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-md bg-sky-900/60 text-sky-300 border border-sky-700/60">
                  PDF &bull; DOCX
                </span>
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                {t('translation.inplaceSubtitle')}
              </p>
              <div className="flex items-center gap-2 text-[11px] text-sky-300/80 pt-1 font-sans">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>{t('translation.inplacePreserveNotice')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Configuration Card */}
        <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-6">
          {/* Document Selector Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="inplace-doc-select" className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-sky-400" />
                <span>{t('translation.inplaceSelectDoc')}</span>
              </label>
              <span className="text-[11px] text-slate-400 font-mono">
                {inp.documents.length} {t('common.document')}{inp.documents.length === 1 ? '' : 's'} PDF/DOCX
              </span>
            </div>

            {inp.documents.length === 0 ? (
              <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-800/40 text-amber-300 text-xs flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                <p className="leading-relaxed">
                  {t('translation.inplaceNoCompatibleDocs')}
                </p>
              </div>
            ) : (
              <select
                id="inplace-doc-select"
                value={inp.selectedDoc?.id || ''}
                disabled={inp.isTranslating}
                onChange={(e) => {
                  const found = inp.documents.find((d) => d.id === e.target.value)
                  inp.setSelectedDoc(found || null)
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-slate-200 outline-none text-xs focus-ring font-mono disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <option value="">-- {t('translation.selectDocPlaceholder')} --</option>
                {inp.documents.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    [{doc.fileType.toUpperCase()}] {doc.filename} ({doc.numPages > 0 ? `${doc.numPages} pag.` : ''} • {(doc.fileSize / 1024).toFixed(0)} KB)
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Languages Selector */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div>
              <label htmlFor="inplace-source-lang" className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                {t('translation.sourceLang')}
              </label>
              <select
                id="inplace-source-lang"
                value={inp.sourceLang}
                disabled={inp.isTranslating}
                onChange={(e) => inp.setSourceLang(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-slate-200 outline-none text-xs focus-ring font-mono font-semibold disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </div>

            <div className="relative">
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="inplace-target-lang" className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                  {t('translation.targetLang')}
                </label>
                <button
                  type="button"
                  onClick={inp.handleSwapLanguages}
                  disabled={inp.isTranslating}
                  title={t('translation.swapLanguages')}
                  aria-label={t('translation.swapLanguages')}
                  className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded-lg text-[10px] font-medium flex items-center gap-1 transition-all active:scale-90 disabled:opacity-50 cursor-pointer"
                >
                  <ArrowLeftRight className="w-3 h-3" />
                  <span>{t('translation.swapLanguages')}</span>
                </button>
              </div>
              <select
                id="inplace-target-lang"
                value={inp.targetLang}
                disabled={inp.isTranslating}
                onChange={(e) => inp.setTargetLang(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-slate-200 outline-none text-xs focus-ring font-mono font-semibold disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Destination Folder Picker */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="inplace-target-dir" className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-sky-400" />
                <span>{t('translation.inplaceTargetDirLabel')}</span>
              </label>
              {!inp.targetDir.trim() && (
                <span className="text-[10px] text-amber-400 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {t('translation.inplaceTargetDirRequired')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                id="inplace-target-dir"
                value={inp.targetDir}
                readOnly
                placeholder={t('translation.inplaceTargetDirPlaceholder')}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-slate-300 text-xs font-mono placeholder:text-slate-600 focus-ring"
              />
              <button
                type="button"
                onClick={async () => {
                  await inp.handleSelectTargetDir()
                  if (inp.targetDir && onUpdateSettings) {
                    onUpdateSettings({ translationOutputFolder: inp.targetDir })
                  }
                }}
                disabled={inp.isTranslating}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-all focus-ring flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Folder className="w-4 h-4 text-sky-400" />
                <span>{t('translation.inplaceBrowse')}</span>
              </button>
              {inp.targetDir && (
                <button
                  type="button"
                  onClick={() => inp.setTargetDir('')}
                  disabled={inp.isTranslating}
                  className="p-2 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer disabled:opacity-50"
                  title={t('translation.inplaceResetDir')}
                  aria-label={t('translation.inplaceResetDir')}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-400">
              {t('translation.inplaceTargetDirNotice')}
            </p>
          </div>

          {/* Live Translation Progress Box */}
          {inp.isTranslating && (
            <div className="p-4 bg-slate-950/90 border border-sky-900/60 rounded-2xl space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <Loader2 className="w-4 h-4 animate-spin text-sky-400 shrink-0" />
                  <span className="text-sky-300 font-semibold truncate">{phaseLabel}</span>
                </div>
                <div className="text-right shrink-0">
                  <span className="font-mono text-slate-300 font-bold text-xs">{progressPercent}%</span>
                  {inp.translateProgress?.page && inp.translateProgress?.total_pages && (
                    <span className="text-[11px] text-slate-400 font-mono ml-2">
                      (Pag. {inp.translateProgress.page}/{inp.translateProgress.total_pages})
                    </span>
                  )}
                </div>
              </div>

              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-sky-500 via-cyan-400 to-indigo-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(5, progressPercent)}%` }}
                />
              </div>
            </div>
          )}

          {/* Completion & Error Status Banners */}
          {inp.status && (
            <div
              role={inp.status.success ? 'status' : 'alert'}
              aria-live="polite"
              className={`p-4 rounded-xl text-xs flex items-start justify-between gap-3 ${
                inp.status.success
                  ? 'bg-emerald-950/40 border border-emerald-800/60 text-emerald-300'
                  : 'bg-rose-950/40 border border-rose-800/60 text-rose-300'
              }`}
            >
              <div className="flex items-start gap-2.5">
                {inp.status.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <span className="font-medium leading-relaxed">{inp.status.message}</span>
              </div>
              <button
                type="button"
                onClick={() => inp.setStatus(null)}
                aria-label={t('common.close')}
                className="text-slate-400 hover:text-slate-200 transition-colors p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Action Trigger Bar */}
          <div className="pt-2 flex items-center justify-end">
            <button
              type="button"
              onClick={() => inp.handleStartInplaceTranslation()}
              disabled={!isFormValid}
              className="px-6 py-3 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs rounded-xl transition-all focus-ring active:scale-95 flex items-center gap-2.5 shadow-lg shadow-sky-950/40 cursor-pointer"
            >
              {inp.isTranslating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t('translation.inplaceTranslating')}</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>{t('translation.inplaceStartBtn')}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
