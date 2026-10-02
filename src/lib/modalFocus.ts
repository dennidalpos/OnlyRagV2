interface ModalEntry {
  root: HTMLElement
  panel: HTMLElement
  priority: number
  dismissible: () => boolean
  close: () => void
  previous: HTMLElement | null
}

const stack: ModalEntry[] = []
const originalInert = new Map<HTMLElement, string | null>()
let observer: MutationObserver | undefined

function topModal(): ModalEntry | undefined {
  return stack.reduce<ModalEntry | undefined>((top, entry) => (!top || entry.priority >= top.priority ? entry : top), undefined)
}

function syncBackground(): void {
  const top = topModal()
  for (const [element, value] of originalInert) {
    if (element.parentElement === document.body) continue
    if (value === null) element.removeAttribute('inert')
    else element.setAttribute('inert', value)
    originalInert.delete(element)
  }
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement)) continue
    if (!originalInert.has(child)) originalInert.set(child, child.getAttribute('inert'))
    child.toggleAttribute('inert', !!top && child !== top.root)
  }
}

function tabbable(panel: HTMLElement): HTMLElement[] {
  const candidates = Array.from(
    panel.querySelectorAll<HTMLElement>(
      'a[href], area[href], button, input:not([type="hidden"]), select, textarea, iframe, [tabindex], [contenteditable="true"]',
    ),
  )
  const eligible = candidates.filter((element) => {
    if (element.matches(':disabled') || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false
    if (element.tabIndex < 0 && (!element.isContentEditable || element.hasAttribute('tabindex'))) return false
    for (let current: HTMLElement | null = element; current && current !== panel; current = current.parentElement) {
      const style = getComputedStyle(current)
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
    }
    return true
  })
  return eligible
    .filter((element) => {
      if (element instanceof HTMLInputElement && element.type === 'radio' && element.name) {
        const group = eligible.filter(
          (item): item is HTMLInputElement =>
            item instanceof HTMLInputElement && item.type === 'radio' && item.name === element.name && item.form === element.form,
        )
        if (element !== (group.find((item) => item.checked) || group[0])) return false
      }
      return true
    })
    .sort((left, right) => (left.tabIndex > 0 ? left.tabIndex : Infinity) - (right.tabIndex > 0 ? right.tabIndex : Infinity))
}

function containFocus(event: FocusEvent): void {
  const top = topModal()
  if (top && event.target instanceof Node && !top.panel.contains(event.target)) top.panel.focus({ preventScroll: true })
}

function handleKeyDown(event: KeyboardEvent): void {
  const top = topModal()
  if (!top) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (top.dismissible()) top.close()
  } else if (event.key === 'Tab') {
    const controls = tabbable(top.panel)
    const active = document.activeElement
    const index = controls.indexOf(active as HTMLElement)
    if (!controls.length || index < 0 || (!event.shiftKey && index === controls.length - 1) || (event.shiftKey && index === 0)) {
      event.preventDefault()
      const target = event.shiftKey ? controls.at(-1) : controls[0]
      ;(target || top.panel).focus({ preventScroll: true })
    }
  }
}

/** Shared stack owns focus and inert state; cleanup never implies approval or rejection. */
export function registerModal(root: HTMLElement, panel: HTMLElement, priority: number, dismissible: () => boolean, close: () => void): () => void {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const entry: ModalEntry = { root, panel, priority, dismissible, close, previous }
  stack.push(entry)
  if (stack.length === 1) {
    window.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('focusin', containFocus, true)
    observer = new MutationObserver(syncBackground)
    observer.observe(document.body, { childList: true })
  }
  syncBackground()
  if (topModal() === entry) panel.focus({ preventScroll: true })
  return () => {
    const wasTop = topModal() === entry
    const index = stack.indexOf(entry)
    if (index < 0) return
    stack.splice(index, 1)
    for (const remaining of stack) {
      if (remaining.previous && entry.panel.contains(remaining.previous)) remaining.previous = entry.previous
    }
    if (stack.length) {
      syncBackground()
    } else {
      observer?.disconnect()
      observer = undefined
      window.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('focusin', containFocus, true)
      for (const [element, value] of originalInert) {
        if (value === null) element.removeAttribute('inert')
        else element.setAttribute('inert', value)
      }
      originalInert.clear()
    }
    if (wasTop) {
      const top = topModal()
      const target =
        entry.previous?.isConnected && !entry.previous.closest('[inert]') && (!top || top.panel.contains(entry.previous)) ? entry.previous : top?.panel
      target?.focus({ preventScroll: true })
    }
  }
}

export function isTopModal(root: HTMLElement | null): boolean {
  return topModal()?.root === root
}
