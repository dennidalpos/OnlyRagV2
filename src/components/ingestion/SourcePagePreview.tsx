import React, { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { apiService } from '../../services/api'
import { RenderedPagePreview } from './RenderedPagePreview'
import { useTranslation } from '../../i18n'

interface SourcePagePreviewProps {
  docId: string
  pageNumber: number
  totalPages: number
  pageContent: string
  zoomLevel?: number
}

export const SourcePagePreview: React.FC<SourcePagePreviewProps> = ({
  docId,
  pageNumber,
  totalPages,
  pageContent,
  zoomLevel = 100,
}) => {
  const { t } = useTranslation()
  const [imageBase64, setImageBase64] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)

  useEffect(() => {
    let isMounted = true
    if (!docId) return

    const loadPreview = async () => {
      setIsLoading(true)
      try {
        const previewData = await apiService.getDocumentPagePreview(docId, pageNumber)
        if (isMounted && previewData && previewData.imageBase64) {
          setImageBase64(previewData.imageBase64)
        } else if (isMounted) {
          setImageBase64(null)
        }
      } catch (err) {
        if (isMounted) setImageBase64(null)
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    loadPreview()
    return () => {
      isMounted = false
    }
  }, [docId, pageNumber])

  const scale = zoomLevel / 100

  return (
    <div
      id={`source-page-${pageNumber}`}
      data-page-number={pageNumber}
      className="w-full flex justify-center py-2 select-text"
      style={{ transform: `scale(${scale})`, transformOrigin: 'top center', transition: 'transform 0.15s ease-out' }}
    >
      <div className="w-full max-w-2xl bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-xl min-h-[580px] flex flex-col space-y-3">
        {/* Source Header Bar */}
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5 text-[11px] font-mono text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-cyan-300 font-semibold">{t('ingestion.sourceLabel')}</span>
          </div>
          <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] text-cyan-400 font-mono">
            {t('ingestion.pagePosition', { current: pageNumber, total: totalPages })}
          </span>
        </div>

        {/* Content View: Raster image preview or structured layout */}
        <div className="flex-1 flex flex-col justify-start">
          {isLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 space-y-3 text-slate-400 min-h-[400px]">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
              <span className="text-xs text-slate-400 font-medium">{t('ingestion.loadingSourcePreview')}</span>
            </div>
          ) : imageBase64 ? (
            <div className="flex justify-center items-center bg-slate-950/80 border border-slate-800 rounded-lg p-2 overflow-hidden shadow-inner">
              <img
                src={`data:image/png;base64,${imageBase64}`}
                alt={t('ingestion.sourcePageAlt', { current: pageNumber })}
                className="w-full h-auto object-contain max-h-[750px] rounded shadow-md"
              />
            </div>
          ) : (
            <RenderedPagePreview
              pageNumber={pageNumber}
              pageContent={pageContent}
            />
          )}
        </div>
      </div>
    </div>
  )
}
