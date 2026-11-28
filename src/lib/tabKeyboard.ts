import type React from 'react'

/** Automatic activation for local panels. Nested buttons (for example Close) keep their own keys. */
export function handleTabKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
  const list = event.currentTarget
  const focused = event.target as HTMLElement
  if (focused.getAttribute('role') !== 'tab' || focused.closest('[role="tablist"]') !== list) return
  const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]')).filter(
    (tab) => tab.closest('[role="tablist"]') === list && !tab.hasAttribute('disabled'),
  )
  const index = tabs.indexOf(focused)
  const vertical = list.getAttribute('aria-orientation') === 'vertical'
  let next: number
  if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = tabs.length - 1
  else if (event.key === (vertical ? 'ArrowDown' : 'ArrowRight')) next = (index + 1) % tabs.length
  else if (event.key === (vertical ? 'ArrowUp' : 'ArrowLeft')) next = (index - 1 + tabs.length) % tabs.length
  else return
  event.preventDefault()
  tabs[next]?.focus()
  tabs[next]?.click()
}
