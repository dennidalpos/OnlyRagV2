import { useCallback, useEffect, useState } from 'react'
import type { CodingHistoryRecoverySummary } from '../../../shared/ipc/ipcContract'
import { errorMessage } from '../../../shared/domain/errors/errorMessage'
import { useTranslation } from '../../i18n'

interface Props {
  storageFailed: boolean
  onRecovered: () => void
}

export function CodingHistoryRecoveryBanner({ storageFailed, onRecovered }: Props) {
  const { t } = useTranslation()
  const [records, setRecords] = useState<CodingHistoryRecoverySummary[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exportedPath, setExportedPath] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const latest = await window.electronAPI?.listCodingHistoryRecovery?.()
    if (latest) setRecords(latest)
  }, [])

  useEffect(() => {
    let active = true
    void window.electronAPI
      ?.listCodingHistoryRecovery?.()
      .then((latest) => {
        if (active && latest) setRecords(latest)
      })
      .catch((failure: unknown) => {
        if (active) setError(errorMessage(failure))
      })
    return () => {
      active = false
    }
  }, [storageFailed])

  const act = async (record: CodingHistoryRecoverySummary, action: 'retry' | 'export') => {
    const api = window.electronAPI
    if (!api?.actOnCodingHistoryRecovery) return
    setBusyId(record.recoveryId)
    setError(null)
    setExportedPath(null)
    try {
      let destinationDirectory: string | undefined
      if (action === 'export') {
        destinationDirectory = (await api.openDirectoryDialog({ title: t('coding.historyRecoveryExportTitle') })) || undefined
        if (!destinationDirectory) return
      }
      const result = await api.actOnCodingHistoryRecovery({ recoveryId: record.recoveryId, action, destinationDirectory })
      if (result.status === 'refused') setError(result.error || t('coding.historyRecoveryRefused'))
      if (result.exportPath) setExportedPath(result.exportPath)
      if (action === 'retry' && result.status === 'complete') onRecovered()
      await refresh()
    } catch (failure: unknown) {
      setError(errorMessage(failure))
    } finally {
      setBusyId(null)
    }
  }

  if (records.length === 0 && !error && !exportedPath) return null
  return (
    <div role="alert" className="border-b border-amber-600/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-100">
      {records.map((record) => (
        <div key={record.recoveryId} className="flex flex-wrap items-center gap-2 py-1">
          <span>
            {t('coding.historyRecovery')} {record.sessionId} ({record.workspacePath || t('coding.noProjectAttached')})
          </span>
          <button
            type="button"
            disabled={busyId !== null}
            onClick={() => void act(record, 'retry')}
            className="min-h-11 rounded border border-amber-600 px-2 py-2 disabled:opacity-50"
          >
            {t('coding.historyRecoveryRetry')}
          </button>
          <button
            type="button"
            disabled={busyId !== null}
            onClick={() => void act(record, 'export')}
            className="min-h-11 rounded border border-amber-600 px-2 py-2 disabled:opacity-50"
          >
            {t('coding.historyRecoveryExport')}
          </button>
        </div>
      ))}
      {error && <p>{t('coding.deletionRecoveryError', { message: error })}</p>}
      {exportedPath && <p>{t('coding.deletionExported', { path: exportedPath })}</p>}
    </div>
  )
}
