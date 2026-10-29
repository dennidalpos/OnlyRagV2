import { useState } from 'react'
import { errorMessage } from '../../../shared/domain/errors/errorMessage'
import { useTranslation } from '../../i18n'

interface Props {
  onRetry: () => void
  onExport: (destinationDirectory: string) => Promise<string[]>
}

export function CodingStorageFailureBanner({ onRetry, onExport }: Props) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paths, setPaths] = useState<string[]>([])

  const exportMemory = async () => {
    setBusy(true)
    setError(null)
    setPaths([])
    try {
      const destination = await window.electronAPI?.openDirectoryDialog({ title: t('coding.historyRecoveryExportTitle') })
      if (destination) setPaths(await onExport(destination))
    } catch (failure: unknown) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-amber-600/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-100">
      <span>{t('coding.storageFailed')}</span>
      <button type="button" disabled={busy} onClick={onRetry} className="min-h-11 rounded border border-amber-600 px-2 py-2 disabled:opacity-50">
        {t('coding.storageRetry')}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void exportMemory()}
        className="min-h-11 rounded border border-amber-600 px-2 py-2 disabled:opacity-50"
      >
        {t('coding.storageExportMemory')}
      </button>
      {error && <p className="w-full break-all">{t('coding.deletionRecoveryError', { message: error })}</p>}
      {paths.map((exportPath) => (
        <p key={exportPath} className="w-full break-all">
          {t('coding.deletionExported', { path: exportPath })}
        </p>
      ))}
    </div>
  )
}
