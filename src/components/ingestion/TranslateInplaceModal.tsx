import React, { useState, useEffect } from 'react'
import { Languages, AlertTriangle, X, Loader2, Folder } from 'lucide-react'
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
  onConfirm: (sourceLang: string, targetLang: string, backupOriginal: boolean, targetDir?: string) => void
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
  const [backupOriginal, setBackupOriginal] = useState<boolean>(true)
  const [targetDir, setTargetDir] = useState<string>(defaultTargetDir || '')

  useEffect(() => {
    if (isOpen) {
      setTargetDir(defaultTargetDir || '')
    }
  }, [isOpen, defaultTargetDir])

  if (!isOpen) return null

  const handleSelectTargetDir = async () => {
    if (!window.electronAPI) return
    const dir = await window.electronAPI.openDirectoryDialog({
      title: 'Seleziona cartella per il file tradotto',
    })
    if (dir) {
      setTargetDir(dir)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center shrink-0">
              <Languages className="w-4 h-4 text-sky-400" />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-slate-100 text-sm">{t('ingestion.translateInplaceModalTitle')}</h2>
              <p className="text-[11px] text-slate-400 font-mono truncate">{filename}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isTranslating}
            aria-label={t('common.close')}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg transition-colors focus-ring disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-800/60 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-200/90 leading-relaxed">
              {targetDir
                ? t('ingestion.translateInplaceTargetDirNotice')
                : t('ingestion.translateInplaceWarning')}
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
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 outline-none text-xs focus-ring font-mono disabled:opacity-50"
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
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 outline-none text-xs focus-ring font-mono disabled:opacity-50"
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Backup Original Option */}
          <div className="flex items-center gap-2.5 pt-1">
            <input
              type="checkbox"
              id="translate-inplace-backup"
              checked={backupOriginal}
              disabled={isTranslating || Boolean(targetDir)}
              onChange={(e) => setBackupOriginal(e.target.checked)}
              className="w-4 h-4 rounded bg-slate-950 border border-slate-700 text-sky-500 focus:ring-sky-500/50 cursor-pointer disabled:opacity-50"
            />
            <label htmlFor="translate-inplace-backup" className="text-xs text-slate-300 cursor-pointer select-none">
              {t('ingestion.translateInplaceBackupLabel')}
            </label>
          </div>

          {/* Target Folder Option */}
          <div className="space-y-1.5 pt-1">
            <label className="block text-[11px] font-bold uppercase text-slate-400" htmlFor="translate-inplace-target-dir">
              {t('ingestion.translateInplaceTargetDirLabel')}
            </label>
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
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl transition-all focus-ring flex items-center gap-1.5 shrink-0"
              >
                <Folder className="w-3.5 h-3.5" />
                <span>{t('ingestion.translateInplaceBrowse')}</span>
              </button>
              {targetDir && (
                <button
                  type="button"
                  onClick={() => setTargetDir('')}
                  disabled={isTranslating}
                  className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors"
                  title="Resetta cartella"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
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
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-semibold rounded-xl transition-all focus-ring active:scale-95 disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(sourceLang, targetLang, backupOriginal, targetDir || undefined)}
            disabled={isTranslating || sourceLang === targetLang}
            className="px-3.5 py-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold text-xs rounded-xl transition-all focus-ring active:scale-95 flex items-center gap-2"
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
