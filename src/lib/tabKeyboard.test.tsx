import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { handleTabKeyDown } from './tabKeyboard'

it('moves and activates tabs with wrapping and Home/End without hijacking nested actions', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  function Tabs() {
    const [active, setActive] = useState(0)
    return (
      <div role="tablist" onKeyDown={handleTabKeyDown}>
        {[0, 1, 2].map((index) => (
          <div key={index} role="tab" tabIndex={active === index ? 0 : -1} aria-selected={active === index} onClick={() => setActive(index)}>
            Tab {index}
            <button type="button">Nested action</button>
          </div>
        ))}
      </div>
    )
  }
  try {
    await act(async () => root.render(<Tabs />))
    const tabs = host.querySelectorAll<HTMLElement>('[role="tab"]')
    tabs[0].focus()
    for (const [key, index] of [
      ['ArrowLeft', 2],
      ['Home', 0],
      ['End', 2],
      ['ArrowRight', 0],
    ] as const) {
      await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
      expect(document.activeElement).toBe(tabs[index])
      expect(tabs[index].getAttribute('aria-selected')).toBe('true')
      expect([...tabs].filter((tab) => tab.tabIndex === 0)).toHaveLength(1)
    }
    const nested = tabs[0].querySelector('button')!
    nested.focus()
    const key = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })
    await act(async () => nested.dispatchEvent(key))
    expect(document.activeElement).toBe(nested)
    expect(key.defaultPrevented).toBe(false)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
