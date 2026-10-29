import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { Tooltip } from './Tooltip'
import { Modal } from './Modal'

describe('shared informational tooltip', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.useRealTimers()
  })
  const help = () => <Tooltip helpKey="settings_wordWrapDesc" />
  const render = async (content = help(), language: 'it' | 'en' = 'en') =>
    act(async () => root.render(<I18nProvider initialLanguage={language}>{content}</I18nProvider>))
  const tick = async (ms: number) => act(async () => vi.advanceTimersByTime(ms))
  const escape = async () => act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))

  it('opens on focus, describes the trigger and dismisses without moving focus', async () => {
    await render()
    const button = host.querySelector('button')!
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    await act(async () => button.focus())
    const bubble = document.querySelector('[role="tooltip"]')!
    expect(bubble.textContent).toMatch(/wrap/i)
    expect(button.getAttribute('aria-describedby')).toBe(bubble.id)
    expect(document.activeElement).toBe(button)
    await escape()
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    expect(document.activeElement).toBe(button)
    expect(button.hasAttribute('aria-describedby')).toBe(false)
  })

  it('allows crossing the pointer gap and reading the hovered bubble', async () => {
    await render()
    const anchor = host.querySelector('span')!
    await act(async () => anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    await tick(250)
    const bubble = document.querySelector('[role="tooltip"]')!
    expect(bubble).not.toBeNull()
    await act(async () => {
      anchor.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
      bubble.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))
    })
    await tick(500)
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull()
    await act(async () => bubble.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
    await tick(150)
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('clamps at viewport edges and moves above the trigger', async () => {
    await render()
    const anchor = host.querySelector('span')!
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
      left: 1000,
      top: 750,
      bottom: 780,
      width: 20,
      height: 30,
      right: 1020,
      x: 1000,
      y: 750,
      toJSON: () => ({}),
    })
    await act(async () => host.querySelector('button')!.focus())
    const bubble = document.querySelector<HTMLElement>('[role="tooltip"]')!
    vi.spyOn(bubble, 'getBoundingClientRect').mockReturnValue({ width: 320, height: 160 } as DOMRect)
    await act(async () => window.dispatchEvent(new Event('resize')))
    expect(parseFloat(bubble.style.left)).toBeGreaterThanOrEqual(8)
    expect(parseFloat(bubble.style.left) + 320).toBeLessThanOrEqual(window.innerWidth - 8)
    expect(parseFloat(bubble.style.top) + 160).toBeLessThan(750)
  })

  it('uses the active modal layer and gives Escape to help before closing the dialog', async () => {
    const close = vi.fn()
    await render(
      <>
        <Modal isOpen onClose={vi.fn()}>
          <button>Base</button>
        </Modal>
        <Modal isOpen layer="nested" onClose={close}>
          {help()}
        </Modal>
      </>,
    )
    const dialogs = document.querySelectorAll('[role="dialog"]')
    const button = dialogs[1].querySelector('button')!
    await act(async () => button.focus())
    const bubble = document.querySelector('[role="tooltip"]')!
    expect(dialogs[1].querySelector('[data-tooltip-layer]')?.contains(bubble)).toBe(true)
    expect(bubble.closest('[inert]')).toBeNull()
    await escape()
    expect(close).not.toHaveBeenCalled()
    await escape()
    expect(close).toHaveBeenCalledOnce()
  })

  it('retains existing descriptions, makes static triggers focusable and uses Italian help', async () => {
    await render(
      <Tooltip helpKey="settings_wordWrapDesc">
        <span aria-describedby="existing">Wrap</span>
      </Tooltip>,
      'it',
    )
    const trigger = host.querySelector<HTMLElement>('[aria-describedby="existing"]')!
    expect(trigger.tabIndex).toBe(0)
    await act(async () => trigger.focus())
    expect(trigger.getAttribute('aria-describedby')).toMatch(/^existing .+/)
    expect(document.querySelector('[role="tooltip"]')?.textContent).toMatch(/capo/i)
    await act(async () => trigger.blur())
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('describes a focused control inside a labelled trigger without replacing its accessible name', async () => {
    await render(
      <Tooltip helpKey="settings_wordWrapDesc">
        <label>
          Wrap
          <input type="checkbox" />
        </label>
      </Tooltip>,
    )
    const input = host.querySelector('input')!
    await act(async () => input.focus())
    expect(input.getAttribute('aria-describedby')).toBe(document.querySelector('[role="tooltip"]')?.id)
    await escape()
    expect(input.hasAttribute('aria-describedby')).toBe(false)
    expect(document.activeElement).toBe(input)
  })
})
