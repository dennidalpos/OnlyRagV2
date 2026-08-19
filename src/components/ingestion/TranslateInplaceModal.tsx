import React, { useState } from 'react'
import { Languages, AlertTriangle, X, Loader2 } from 'lucide-react'
import { LANGUAGES } from '../../hooks/useTranslation'
import { useTranslation } from '../../i18n'

interface TranslateInplaceModalProps {
  isOpen: boolean
  filename: string
  isTranslating: boolean
  onClose: () => void
  onConfirm: (sourceLang: string, targetLang: string) => void
}

export const TranslateInplaceModal: React.FC<TranslateInplaceModalProps> = ({
  isOpen,
  filename,
  isTranslating,
  onClose,
  onConfirm,
}) => {
  const { t } = useTranslation()
  const [sourceLang, setSourceLang] = useState('Italian')
  const [targetLang, setTargetLang] = useState('English')

  if (!isOpen) return null

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
            <p className="text-xs text-amber-200/90 leading-relaxed">{t('ingestion.translateInplaceWarning')}</p>
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
            onClick={() => onConfirm(sourceLang, targetLang)}
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
