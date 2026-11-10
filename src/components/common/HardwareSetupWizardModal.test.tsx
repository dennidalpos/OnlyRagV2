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
  it('ignores an obsolete successful measurement after leaving and reentering the summary', async () => {
    const previous = window.electronAPI
    let stale!: (value: unknown) => void
    const check = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            stale = resolve
          }),
      )
      .mockResolvedValue({ allowed: false, requiredGB: 8, freeGB: null, missingGB: null, error: 'fresh failure' })
    window.electronAPI = { checkDiskSpace: check } as unknown as typeof window.electronAPI
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () =>
        root.render(
          <HardwareSetupWizardModal
            isOpen
            onClose={vi.fn()}
            diagnostics={null}
            settings={DEFAULT_APP_SETTINGS}
            onUpdateSettings={vi.fn()}
            onRefreshDiagnostics={vi.fn()}
          />,
        ),
      )
      const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!
      await act(async () => button('Configurazione base 1 click').click())
      await act(async () => button('Indietro').click())
      await act(async () => button('Avanti').click())
      expect(check).toHaveBeenCalledTimes(2)
      await act(async () => stale({ allowed: true, requiredGB: 8, freeGB: 40, missingGB: 0 }))
      expect(document.body.textContent).toContain('fresh failure')
      expect(button('Conferma').disabled).toBe(true)
    } finally {
      await act(async () => root.unmount())
      container.remove()
      window.electronAPI = previous
    }
  })

  it.each(['measurement-error', 'ipc-error', 'insufficient'])(
    'blocks downloads on %s and enables them only after a fresh successful retry',
    async (failure) => {
      const previous = window.electronAPI
      const check = vi.fn()
      if (failure === 'ipc-error') check.mockRejectedValueOnce(new Error('controlled IPC failure'))
      else
        check.mockResolvedValueOnce(
          failure === 'insufficient'
            ? { allowed: false, requiredGB: 8, freeGB: 1, missingGB: 9 }
            : { allowed: false, requiredGB: 8, freeGB: null, missingGB: null, error: 'controlled disk measurement unavailable' },
        )
      let recover!: (value: unknown) => void
      check.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            recover = resolve
          }),
      )
      const pull = vi.fn().mockResolvedValue({ success: false, error: 'controlled stop after admission' })
      window.electronAPI = { checkDiskSpace: check, pullOllamaModel: pull } as unknown as typeof window.electronAPI
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)
      const update = vi.fn()
      try {
        await act(async () =>
          root.render(
            <HardwareSetupWizardModal
              isOpen
              onClose={vi.fn()}
              diagnostics={null}
              settings={DEFAULT_APP_SETTINGS}
              onUpdateSettings={update}
              onRefreshDiagnostics={vi.fn()}
            />,
          ),
        )
        const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!
        await act(async () => button('Configurazione base 1 click').click())
        expect(document.querySelector('[role="alert"]')).toBeTruthy()
        expect(button('Conferma').disabled).toBe(true)
        await act(async () => button('Conferma').click())
        expect(pull).not.toHaveBeenCalled()
        expect(update).not.toHaveBeenCalled()
        await act(async () => button('Riprova').click())
        expect(check).toHaveBeenCalledTimes(2)
        expect(button('Conferma').disabled).toBe(true)
        await act(async () => recover({ allowed: true, requiredGB: 8, freeGB: 40, missingGB: 0 }))
        expect(button('Conferma').disabled).toBe(false)
        await act(async () => button('Conferma').click())
        expect(pull).toHaveBeenCalledTimes(1)
      } finally {
        await act(async () => root.unmount())
        container.remove()
        window.electronAPI = previous
      }
    },
  )

  it('dismisses with Escape or X without assigning the recommended models', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const update = vi.fn()
    const close = vi.fn()
    try {
      await act(async () =>
        root.render(
          <HardwareSetupWizardModal
            isOpen
            onClose={close}
            diagnostics={readyDiagnostics}
            settings={DEFAULT_APP_SETTINGS}
            onUpdateSettings={update}
            onRefreshDiagnostics={vi.fn()}
          />,
        ),
      )
      await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
      expect(close).toHaveBeenCalledOnce()
      expect(update).not.toHaveBeenCalled()
      const dismiss = document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Chiudi"]')!
      await act(async () => dismiss.click())
      expect(close).toHaveBeenCalledTimes(2)
      expect(update).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

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
