import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { Modal } from './Modal'

it('contains focus, preserves inert state and gives only the highest layer Escape', async () => {
  const host = document.createElement('div')
  const trigger = document.createElement('button')
  const alreadyInert = document.createElement('aside')
  alreadyInert.setAttribute('inert', 'inert')
  document.body.append(trigger, alreadyInert, host)
  trigger.focus()
  const root = createRoot(host)
  const baseClose = vi.fn()
  const nestedClose = vi.fn()
  const approvalClose = vi.fn()
  const render = (nested: boolean, approval: boolean) =>
    root.render(
      <StrictMode>
        <Modal isOpen onClose={baseClose}>
          <button>Base first</button>
          <button>Base last</button>
        </Modal>
        <Modal isOpen={nested} layer="nested" onClose={nestedClose}>
          <button>Nested first</button>
          <button>Nested last</button>
        </Modal>
        <Modal isOpen={approval} layer="approval" dismissible={false} onClose={approvalClose}>
          <button>Approve explicitly</button>
        </Modal>
      </StrictMode>,
    )
  try {
    await act(async () => render(false, false))
    expect(host.hasAttribute('inert')).toBe(true)
    const baseDialog = document.querySelector('[role="dialog"]')!
    expect(document.activeElement).toBe(baseDialog.firstElementChild)
    const baseLast = Array.from(baseDialog.querySelectorAll('button')).at(-1)!
    baseLast.focus()
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
    expect(document.activeElement?.textContent).toBe('Base first')
    await act(async () => render(true, true))
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
    expect(dialogs[0].hasAttribute('inert')).toBe(true)
    expect(dialogs[1].hasAttribute('inert')).toBe(true)
    expect(dialogs[2].contains(document.activeElement)).toBe(true)
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(baseClose).not.toHaveBeenCalled()
    expect(nestedClose).not.toHaveBeenCalled()
    expect(approvalClose).not.toHaveBeenCalled()
    await act(async () => render(true, false))
    expect(dialogs[1].hasAttribute('inert')).toBe(false)
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(nestedClose).toHaveBeenCalledOnce()
    expect(baseClose).not.toHaveBeenCalled()
    await act(async () => render(false, false))
    expect(baseDialog.contains(document.activeElement)).toBe(true)
  } finally {
    await act(async () => root.unmount())
    expect(document.activeElement).toBe(trigger)
    expect(alreadyInert.getAttribute('inert')).toBe('inert')
    expect(host.hasAttribute('inert')).toBe(false)
    trigger.remove()
    alreadyInert.remove()
    host.remove()
  }
})

it('keeps an empty panel focused and restores the original trigger when its parent closes first', async () => {
  const host = document.createElement('div')
  const trigger = document.createElement('button')
  document.body.append(trigger, host)
  trigger.focus()
  const root = createRoot(host)
  const initialClose = vi.fn()
  const latestClose = vi.fn()
  const render = (base: boolean, nested: boolean, close = initialClose) =>
    root.render(
      <>
        <Modal isOpen={base} onClose={close}>
          <button>Nested trigger</button>
        </Modal>
        <Modal isOpen={nested} layer="nested" onClose={latestClose}>
          <p>No controls</p>
        </Modal>
      </>,
    )
  try {
    await act(async () => render(true, false))
    const control = document.querySelector<HTMLButtonElement>('[role="dialog"] button')!
    control.focus()
    await act(async () => render(true, false, latestClose))
    expect(document.activeElement).toBe(control)
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(initialClose).not.toHaveBeenCalled()
    expect(latestClose).toHaveBeenCalledOnce()
    await act(async () => render(true, true))
    const panel = document.activeElement
    for (const shiftKey of [false, true]) {
      await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })))
      expect(document.activeElement).toBe(panel)
    }
    await act(async () => render(false, true))
    expect(document.activeElement).toBe(panel)
    await act(async () => render(false, false))
    expect(document.activeElement).toBe(trigger)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    trigger.remove()
  }
})
