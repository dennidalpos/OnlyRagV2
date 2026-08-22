import React, { useState, useEffect } from 'react'
import { Languages, Info, X, Loader2, Folder, AlertCircle } from 'lucide-react'
import { LANGUAGES } from '../../hooks/useTranslation'
import { useTranslation } from '../../i18n'

interface TranslateInplaceModalProps {
  isOpen: boolean
  filename: string
  isTranslating: boolean
  defaultTargetDir?: string
  translateProgress?: {
    page?: number
    totalPages?: number
    percent?: number
    phase?: string
  } | null
  onClose: () => void
  onConfirm: (sourceLang: string, targetLang: string, targetDir: string) => void
}

export const TranslateInplaceModal: React.FC<TranslateInplaceModalProps> = ({
  isOpen,
  filename,
  isTranslating,
  defaultTargetDir,
  translateProgress,
  onClose,
  onConfirm,
}) => {
  const { t } = useTranslation()
  const [sourceLang, setSourceLang] = useState('Italian')
  const [targetLang, setTargetLang] = useState('English')
  const [targetDir, setTargetDir] = useState<string>(defaultTargetDir || '')

  useEffect(() => {
    if (isOpen) {
      setTargetDir(defaultTargetDir || '')
    }
  }, [isOpen, defaultTargetDir])

  // ESC Key Listener for Accessibility
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isTranslating) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isTranslating, onClose])

  if (!isOpen) return null

  const handleSelectTargetDir = async () => {
    if (!window.electronAPI) return
    const dir = await window.electronAPI.openDirectoryDialog({
      title: t('ingestion.translateInplaceBrowseTitle'),
    })
    if (dir) {
      setTargetDir(dir)
    }
  }

  const isFormValid = Boolean(targetDir.trim()) && sourceLang !== targetLang

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="translate-inplace-modal-title"
    >
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center shrink-0">
              <Languages className="w-4 h-4 text-sky-400" />
            </div>
            <div className="min-w-0">
              <h2 id="translate-inplace-modal-title" className="font-bold text-slate-100 text-sm">{t('ingestion.translateInplaceModalTitle')}</h2>
              <p className="text-[11px] text-slate-400 font-mono truncate">{filename}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isTranslating}
            aria-label={t('common.close')}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg transition-colors focus-ring disabled:opacity-50 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="p-3 rounded-xl bg-sky-950/40 border border-sky-800/50 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
            <p className="text-xs text-sky-200/90 leading-relaxed">
              {t('ingestion.translateInplaceTargetDirNotice')}
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="flex-1">
              <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1" htmlFor="translate-inplace-source">
                {t('translation.sourceLang')}
              </label>
              <select
                id="translate-inplace-source"
                value={sourceLang}
                disabled={isTranslating}
                onChange={(e) => setSourceLang(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 outline-none text-xs focus-ring font-mono disabled:opacity-50 cursor-pointer"
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1" htmlFor="translate-inplace-target">
                {t('translation.targetLang')}
              </label>
              <select
                id="translate-inplace-target"
                value={targetLang}
                disabled={isTranslating}
                onChange={(e) => setTargetLang(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 outline-none text-xs focus-ring font-mono disabled:opacity-50 cursor-pointer"
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Mandatory Target Folder Option */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between">
              <label className="block text-[11px] font-bold uppercase text-slate-300" htmlFor="translate-inplace-target-dir">
                {t('ingestion.translateInplaceTargetDirLabel')}
              </label>
              {!targetDir.trim() && (
                <span className="text-[10px] text-amber-400 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {t('common.required' as any) || 'Obbligatoria'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                id="translate-inplace-target-dir"
                value={targetDir}
                readOnly
                placeholder={t('ingestion.translateInplaceTargetDirPlaceholder')}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-slate-300 text-xs font-mono placeholder:text-slate-600 focus-ring"
              />
              <button
                type="button"
                onClick={handleSelectTargetDir}
                disabled={isTranslating}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl transition-all focus-ring flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <Folder className="w-3.5 h-3.5" />
                <span>{t('ingestion.translateInplaceBrowse')}</span>
              </button>
              {targetDir && (
                <button
                  type="button"
                  onClick={() => setTargetDir('')}
                  disabled={isTranslating}
                  className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                  title="Resetta cartella"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {!targetDir.trim() && (
              <p className="text-[11px] text-amber-400/90 pt-0.5">
                {t('ingestion.translateInplaceTargetDirRequired')}
              </p>
            )}
          </div>

          {/* Live Streaming Translation Progress */}
          {isTranslating && (
            <div className="space-y-2 p-3 bg-slate-950/80 border border-sky-900/40 rounded-xl">
              <div className="flex items-center justify-between text-xs">
                <span className="text-sky-300 font-medium flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
                  {translateProgress?.phase === 'extracting_blocks'
                    ? 'Estrazione blocchi di layout...'
                    : translateProgress?.phase === 'translating_blocks'
                      ? 'Traduzione blocchi in corso...'
                      : translateProgress?.phase === 'reconstructing_layout'
                        ? 'Ricostruzione geometrica layout...'
                        : translateProgress?.phase === 'translating_runs'
                          ? 'Traduzione paragrafi in corso...'
                          : 'Traduzione in corso...'}
                </span>
                <span className="text-slate-400 font-mono text-[11px]">
                  {translateProgress?.page && translateProgress?.totalPages
                    ? `Pag. ${translateProgress.page}/${translateProgress.totalPages} (${translateProgress.percent ?? 0}%)`
                    : `${translateProgress?.percent ?? 0}%`}
                </span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-sky-500 to-indigo-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(5, translateProgress?.percent ?? 0)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-800 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isTranslating}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-semibold rounded-xl transition-all focus-ring active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(sourceLang, targetLang, targetDir)}
            disabled={isTranslating || !isFormValid}
            className="px-3.5 py-2 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs rounded-xl transition-all focus-ring active:scale-95 flex items-center gap-2 cursor-pointer shadow-md shadow-sky-950/40"
          >
            {isTranslating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{t('translation.translating')}</span>
              </>
            ) : (
              <span>{t('ingestion.translateInplaceConfirm')}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

