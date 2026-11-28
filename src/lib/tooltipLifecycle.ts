let active: (() => void) | undefined

/** Escape belongs to the open tooltip before it belongs to its enclosing modal. */
export function dismissTooltip(): boolean {
  if (!active) return false
  const close = active
  active = undefined
  close()
  return true
}

export function registerTooltip(close: () => void): () => void {
  dismissTooltip()
  active = close
  return () => {
    if (active === close) active = undefined
  }
}
