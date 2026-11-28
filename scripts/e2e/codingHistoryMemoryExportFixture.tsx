import { createRoot } from 'react-dom/client'
import { CodingStorageFailureBanner } from '../../src/components/coding/CodingStorageFailureBanner'
import { useSessionHistory } from '../../src/hooks/useSessionHistory'
import { I18nProvider } from '../../src/i18n'

const workspace = (window as unknown as { __memoryExportWorkspace: string }).__memoryExportWorkspace

function Fixture() {
  const history = useSessionHistory(workspace)
  return (
    <>
      <button
        type="button"
        disabled={history.isLoadingSessions}
        onClick={() =>
          history.updateSessionContent(history.activeSessionId, {
            actionLogs: [
              ...(history.activeSession?.actionLogs || []),
              {
                id: 'memory-only',
                timestamp: '2026-10-15T00:01:00.000Z',
                type: 'info',
                message: 'Unsaved Unicode revision: 日本語 àèì',
              },
            ],
          })
        }
      >
        Change memory revision
      </button>
      <output id="memory-session">{JSON.stringify(history.activeSession)}</output>
      {history.storageFailed && <CodingStorageFailureBanner onRetry={() => void history.retryStorage()} onExport={history.exportUnsavedSessions} />}
    </>
  )
}

const mount = document.createElement('div')
mount.id = 'memory-export-fixture'
document.body.prepend(mount)
createRoot(mount).render(
  <I18nProvider initialLanguage="en">
    <Fixture />
  </I18nProvider>,
)
