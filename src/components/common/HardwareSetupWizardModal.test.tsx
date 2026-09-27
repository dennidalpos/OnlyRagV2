import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../../shared/domain/settings/appSettingsDefaults'
import type { DiagnosticsData } from '../../types'
import { HardwareSetupWizardModal } from './HardwareSetupWizardModal'

const installedStarterModels = ['qwen2.5-coder:3b', 'llama3.2:3b', 'moondream:latest', 'nomic-embed-text:latest']
const readyDiagnostics = {
  ollama: { status: 'online', models: installedStarterModels },
  gpu: { hasNvidiaGpu: false },
  memory: { totalRAMGB: 16 },
  system: { cpusCount: 8 },
} as DiagnosticsData

describe('one-click hardware setup', () => {
  it('prepares the starter suite for review without saving or downloading', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const update = vi.fn()
    await act(async () =>
      root.render(
        <HardwareSetupWizardModal
          isOpen
          onClose={vi.fn()}
          diagnostics={null}
          settings={{ ...DEFAULT_APP_SETTINGS, medicalModel: 'older-medical:7b', legalModel: 'older-legal:7b' }}
          onUpdateSettings={update}
          onRefreshDiagnostics={vi.fn()}
        />,
      ),
    )

    const button = [...document.querySelectorAll('button')].find((element) => element.textContent?.includes('Configurazione base 1 click')) as HTMLButtonElement
    expect(button).toBeTruthy()
    await act(async () => button.click())

    expect(document.body.textContent).toContain('qwen2.5-coder:3b')
    expect(document.body.textContent).toContain('llama3.2:3b')
    expect(document.body.textContent).toContain('moondream:latest')
    expect(document.body.textContent).toContain('nomic-embed-text:latest')
    expect(document.body.textContent).not.toContain('older-medical:7b')
    expect(document.body.textContent).not.toContain('older-legal:7b')
    expect(update).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('La verifica dello spazio su disco non è disponibile.')

    await act(async () => root.unmount())
    container.remove()
  })

  it('saves the starter assignments only after the user confirms the summary', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const update = vi.fn()
    await act(async () =>
      root.render(
        <HardwareSetupWizardModal
          isOpen
          onClose={vi.fn()}
          diagnostics={readyDiagnostics}
          settings={{ ...DEFAULT_APP_SETTINGS, medicalModel: 'older-medical:7b', legalModel: 'older-legal:7b' }}
          onUpdateSettings={update}
          onRefreshDiagnostics={vi.fn()}
        />,
      ),
    )

    const starterButton = [...document.querySelectorAll('button')].find((element) =>
      element.textContent?.includes('Configurazione base 1 click'),
    ) as HTMLButtonElement
    await act(async () => starterButton.click())
    expect(update).not.toHaveBeenCalled()

    const finishButton = [...document.querySelectorAll('button')].find((element) => element.textContent?.includes('Salva & Completa')) as HTMLButtonElement
    expect(finishButton.disabled).toBe(false)
    await act(async () => finishButton.click())

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        codingModel: 'qwen2.5-coder:3b',
        chatModel: 'llama3.2:3b',
        translationModel: 'llama3.2:3b',
        visionModel: 'moondream:latest',
        embeddingModel: 'nomic-embed-text:latest',
        medicalModel: '',
        legalModel: '',
      }),
    )

    await act(async () => root.unmount())
    container.remove()
  })
})
