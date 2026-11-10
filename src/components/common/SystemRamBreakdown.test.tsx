import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../../i18n/I18nContext'
import { SystemRamBreakdown } from './SystemRamBreakdown'

describe('SystemRamBreakdown', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('labels available, used, and total memory instead of exposing anonymous values', async () => {
    await act(async () =>
      root.render(
        <I18nProvider initialLanguage="it">
          <SystemRamBreakdown memory={{ totalRAMGB: 32, freeRAMGB: 12.5, usedRAMGB: 19.5, ramUsagePercent: 61 }} />
        </I18nProvider>,
      ),
    )

    expect(container.textContent).toContain('Disponibile12.5 GB')
    expect(container.textContent).toContain('In uso19.5 GB')
    expect(container.textContent).toContain('Totale32 GB')
  })
})
