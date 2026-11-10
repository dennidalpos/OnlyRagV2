import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Modal } from '../../src/components/common/Modal'
import { PendingApprovalModal } from '../../src/components/coding/PendingApprovalModal'
import { I18nProvider } from '../../src/i18n'
import '../../src/index.css'

function Fixture() {
  const [base, setBase] = useState(false)
  const [nested, setNested] = useState(false)
  const [approval, setApproval] = useState(false)
  const [rejections, setRejections] = useState(0)
  return (
    <>
      <button id="trigger" onClick={() => setBase(true)}>
        Open base
      </button>
      <p>Background information</p>
      <output id="rejections">{rejections}</output>
      <Modal isOpen={base} onClose={() => setBase(false)} labelledById="base-title">
        <div className="p-5 space-y-3">
          <h2 id="base-title">Base dialog</h2>
          <button hidden>Hidden</button>
          <button disabled>Disabled</button>
          <input aria-label="Base input" />
          <button onClick={() => setNested(true)}>Open nested</button>
          <button onClick={() => setApproval(true)}>Open approval</button>
          <button onClick={() => setBase(false)}>Close base</button>
        </div>
      </Modal>
      <Modal isOpen={nested} onClose={() => setNested(false)} layer="nested" labelledById="nested-title">
        <div className="p-5 space-y-3">
          <h2 id="nested-title">Nested dialog</h2>
          <input aria-label="Nested input" />
          <input type="radio" name="choice" disabled aria-label="Disabled choice" />
          <input type="radio" name="choice" aria-label="First choice" />
          <input type="radio" name="choice" aria-label="Second choice" />
          <button onClick={() => setNested(false)}>Close nested</button>
        </div>
      </Modal>
      <PendingApprovalModal
        pendingApproval={
          approval
            ? {
                runId: 'fixture',
                conversationId: 'fixture',
                planRevisionId: 'fixture',
                workspaceId: 'fixture',
                sessionId: 'fixture',
                type: 'download_file',
                target: 'https://example.test/fixture',
                contentOrCmd: 'fixture only',
              }
            : null
        }
        onApprove={() => setApproval(false)}
        onReject={() => {
          setRejections((value) => value + 1)
          setApproval(false)
        }}
      />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider initialLanguage="en">
      <Fixture />
    </I18nProvider>
  </StrictMode>,
)
