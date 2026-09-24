import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WizardStepHardware } from './WizardStepHardware'

describe('WizardStepHardware remote recovery', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('offers remote retry and configuration without local installation', async () => {
    await act(async () =>
      root.render(
        <WizardStepHardware
          diagnostics={{ ollama: { status: 'offline', models: [] } } as never}
          recommendations={{ profileName: 'Test', safeVramBudgetGB: 0, gpuSummary: 'CPU', ramSummary: '16 GB' } as never}
          downloadedModels={[]}
          isInstallingOllama={false}
          onLaunchOrInstallOllama={vi.fn()}
          onAutoApply={vi.fn()}
          isRemoteMode
          remoteHost="http://ai-server:11434"
          onRetryRemote={vi.fn()}
          onConfigureRemote={vi.fn()}
        />,
      ),
    )

    expect(container.textContent).toContain('Riprova server')
    expect(container.textContent).toContain('Configura server')
    expect(container.textContent).not.toContain('Avvia / Installa Ollama')
  })
})
