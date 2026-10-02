import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ModelContextControl } from './ModelContextControl'
import { DEFAULT_APP_SETTINGS } from '../../../shared/domain/settings/appSettingsDefaults'
import { I18nProvider } from '../../i18n'
import type { DiagnosticsData } from '../../types'

it('assesses the displayed effective window and changes it only on explicit selection', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  const update = vi.fn()
  const diagnostics = { gpu: { hasNvidiaGpu: false }, memory: { totalRAMGB: 32 }, system: { cpusCount: 8 } } as DiagnosticsData
  try {
    await act(async () =>
      root.render(
        <I18nProvider initialLanguage="en">
          <ModelContextControl
            model="custom"
            settings={{ ...DEFAULT_APP_SETTINGS, modelContextLengths: { custom: 8192 } }}
            metrics={{ capabilities: ['completion'], contextLength: 32768, sizeBytes: 4 * 1024 ** 3 }}
            hardwareDefault={16384}
            diagnostics={diagnostics}
            onUpdateSettings={update}
          />
        </I18nProvider>,
      ),
    )
    expect(container.textContent).toContain('8192 ctx')
    expect(container.textContent).toContain('uncertain fit')
    expect(container.textContent).toContain('cache')
    expect(update).not.toHaveBeenCalled()
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === '16K')!
        .click(),
    )
    expect(update).toHaveBeenCalledWith({ modelContextLengths: { custom: 16384 } })
  } finally {
    await act(async () => root.unmount())
  }
})
