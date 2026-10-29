import { useCallback, useEffect, useState } from 'react'
import type { SessionDeletionRecoverySummary } from '../../../shared/ipc/ipcContract'
import { useTranslation } from '../../i18n'
import { errorMessage } from '../../../shared/domain/errors/errorMessage'

interface Props {
  storageFailed: boolean
  onResolved: (sessionIds: readonly string[]) => void
}

export function SessionDeletionRecoveryBanner({ storageFailed, onResolved }: Props) {
  const { t } = useTranslation()
  const [operations, setOperations] = useState<SessionDeletionRecoverySummary[]>([])
  const [total, setTotal] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exportedPath, setExportedPath] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.listSessionDeletionRecovery) return
    const page = await api.listSessionDeletionRecovery({ offset: 0 })
    setOperations(page.operations)
    setTotal(page.total)
  }, [])

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const page = await window.electronAPI?.listSessionDeletionRecovery?.({ offset: 0 })
        if (active && page) {
          setOperations(page.operations)
          setTotal(page.total)
        }
      } catch (failure: unknown) {
        if (active) setError(errorMessage(failure))
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [storageFailed])

  const act = async (operation: SessionDeletionRecoverySummary, action: 'retry' | 'restore' | 'export') => {
    const api = window.electronAPI
    if (!api?.actOnSessionDeletionRecovery) return
    setBusyId(operation.operationId)
    setError(null)
    setExportedPath(null)
    try {
      let destinationDirectory: string | undefined
      if (action === 'export') {
        destinationDirectory = (await api.openDirectoryDialog({ title: t('coding.deletionExportTitle') })) || undefined
        if (!destinationDirectory) return
      }
      const result = await api.actOnSessionDeletionRecovery({ operationId: operation.operationId, action, destinationDirectory })
      if (result.status === 'refused' || (result.status === 'pending' && !result.exportPath)) {
        setError(result.error || 'Recovery remains pending')
      }
      if (result.exportPath) setExportedPath(result.exportPath)
      if (result.status === 'complete') onResolved(operation.sessionIds)
      await refresh()
    } catch (failure: unknown) {
      setError(errorMessage(failure))
    } finally {
      setBusyId(null)
    }
  }

  const loadMore = async () => {
    try {
      const api = window.electronAPI
      if (!api) return
      const page = await api.listSessionDeletionRecovery({ offset: operations.length })
      setOperations((current) => [...current, ...page.operations])
      setTotal(page.total)
    } catch (failure: unknown) {
      setError(errorMessage(failure))
    }
  }

  if (operations.length === 0 && !error && !exportedPath) return null
  return (
    <div role="alert" className="border-b border-amber-600/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-100">
      {operations.map((operation) => (
        <div key={operation.operationId} className="flex flex-wrap items-center gap-2 py-1">
          <span>
            {t(
              operation.status === 'incomplete'
                ? 'coding.deletionRecoveryIncomplete'
                : operation.status === 'complete'
                  ? 'coding.deletionRecoveryComplete'
                  : 'coding.deletionRecovery',
            )}{' '}
            {operation.workspacePath || ''}
          </span>
          <button
            type="button"
            disabled={busyId !== null || operation.status !== 'pending'}
            onClick={() => void act(operation, 'retry')}
            className="rounded border border-amber-600 px-2 py-1 disabled:opacity-50"
          >
            {t('coding.deletionRetry')}
          </button>
          <button
            type="button"
            disabled={busyId !== null || operation.status === 'incomplete'}
            onClick={() => void act(operation, 'restore')}
            className="rounded border border-amber-600 px-2 py-1 disabled:opacity-50"
          >
            {t('coding.deletionRestore')}
          </button>
          <button
            type="button"
            disabled={busyId !== null}
            onClick={() => void act(operation, 'export')}
            className="rounded border border-amber-600 px-2 py-1 disabled:opacity-50"
          >
            {t('coding.deletionExport')}
          </button>
        </div>
      ))}
      {operations.length < total && (
        <button
          type="button"
          disabled={busyId !== null}
          onClick={() => void loadMore()}
          className="rounded border border-amber-600 px-2 py-1 disabled:opacity-50"
        >
          {t('coding.deletionLoadMore')}
        </button>
      )}
      {error && <p>{t('coding.deletionRecoveryError', { message: error })}</p>}
      {exportedPath && <p>{t('coding.deletionExported', { path: exportedPath })}</p>}
    </div>
  )
}
