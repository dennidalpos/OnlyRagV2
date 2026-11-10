import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { CodingStorageFailureBanner } from './CodingStorageFailureBanner'

let root: Root
let container: HTMLDivElement
const chooseDirectory = vi.fn(async () => 'C:/export')
const exportMemory = vi.fn(async (_destination: string) => ['C:/export/snapshot.json'])
const retry = vi.fn()

beforeEach(async () => {
  chooseDirectory.mockReset().mockResolvedValue('C:/export')
  exportMemory.mockReset().mockResolvedValue(['C:/export/snapshot.json'])
  retry.mockReset()
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { openDirectoryDialog: chooseDirectory }
  container = document.createElement('div')
  root = createRoot(container)
  await act(async () =>
    root.render(
      <I18nProvider initialLanguage="en">
        <CodingStorageFailureBanner onRetry={retry} onExport={exportMemory} />
      </I18nProvider>,
    ),
  )
})

afterEach(async () => {
  await act(async () => root.unmount())
})

it('exports from the chosen destination and displays the acknowledged path', async () => {
  await act(async () => container.querySelectorAll('button')[1].click())
  expect(exportMemory).toHaveBeenCalledWith('C:/export')
  expect(container.textContent).toContain('C:/export/snapshot.json')
  await act(async () => container.querySelectorAll('button')[0].click())
  expect(retry).toHaveBeenCalledOnce()
})

it('does not export when the destination dialog is cancelled', async () => {
  chooseDirectory.mockResolvedValue('')
  await act(async () => container.querySelectorAll('button')[1].click())
  expect(exportMemory).not.toHaveBeenCalled()
  expect(container.textContent).not.toContain('Recovery copy saved')
  expect(container.querySelectorAll('button')[1].disabled).toBe(false)
})

it('keeps retry and export available after a refused export without claiming success', async () => {
  exportMemory.mockRejectedValueOnce(new Error('Disk full'))
  await act(async () => container.querySelectorAll('button')[1].click())
  expect(container.textContent).toContain('Disk full')
  expect(container.textContent).not.toContain('Recovery copy saved')
  expect([...container.querySelectorAll('button')].every((button) => !button.disabled)).toBe(true)
})
