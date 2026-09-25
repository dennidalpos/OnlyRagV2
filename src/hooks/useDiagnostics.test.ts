import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings, DiagnosticsData } from '../types'
import { DIAGNOSTICS_STARTUP_RETRY_MS, getDiagnosticsPollDelay, useDiagnostics } from './useDiagnostics'
import { notifyDocumentsChanged } from './useIngestedDocuments'

describe('diagnostics polling policy', () => {
  it('retries quickly while the sidecar is starting or offline', () => {
    expect(getDiagnosticsPollDelay('checking', 10_000)).toBe(DIAGNOSTICS_STARTUP_RETRY_MS)
    expect(getDiagnosticsPollDelay('offline', 10_000)).toBe(DIAGNOSTICS_STARTUP_RETRY_MS)
    expect(getDiagnosticsPollDelay(undefined, 10_000)).toBe(DIAGNOSTICS_STARTUP_RETRY_MS)
  })

  it('uses the normal interval once the sidecar is online', () => {
    expect(getDiagnosticsPollDelay('online', 10_000)).toBe(10_000)
  })

  it('does not lengthen an explicitly shorter interval', () => {
    expect(getDiagnosticsPollDelay('offline', 250)).toBe(250)
  })
})

describe('diagnostics after a document change', () => {
  let root: Root | undefined

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    Reflect.deleteProperty(window, 'electronAPI')
  })

  it('rescans when documents change elsewhere, but not for the change it reports itself', async () => {
    let documentsCount = 0
    const runDiagnostics = vi.fn(async () => ({ sidecar: { status: 'online', documentsCount }, ollama: { models: [] } }) as unknown as DiagnosticsData)
    Object.assign(window, { electronAPI: { runDiagnostics } })
    let latest: DiagnosticsData | null = null
    // Stable across renders, as in AppLayout: a new callback per render restarts the polling effect.
    const settings = { ollamaHost: 'http://127.0.0.1:11434' } as AppSettings
    const selectDefaultModel = () => {}
    function Harness() {
      latest = useDiagnostics(settings, selectDefaultModel, true, 60_000).diagnostics
      return null
    }

    root = createRoot(document.createElement('div'))
    await act(async () => root?.render(createElement(Harness)))
    // The first scan reports the sidecar coming online, which notifies document observers without a rescan.
    expect(runDiagnostics).toHaveBeenCalledTimes(1)

    documentsCount = 1
    await act(async () => notifyDocumentsChanged())
    // One rescan for the ingestion; the count change it reads is announced, again without a rescan.
    expect(runDiagnostics).toHaveBeenCalledTimes(2)
    expect(latest).toMatchObject({ sidecar: { documentsCount: 1 } })
  })
})
