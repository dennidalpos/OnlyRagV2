import { useState, useRef, useEffect } from 'react'

/**
 * Drag-to-resize logic for a horizontally split panel (mouse drag on a divider, plus
 * arrow-key nudging for accessibility). Owns only the width/isResizing state and the
 * event wiring; supports optional localStorage persistence across reloads/sessions.
 */
export function useResizablePanel(initialWidth: number, min: number, max: number, storageKey?: string) {
  const [width, setWidth] = useState<number>(() => {
    if (storageKey && typeof window !== 'undefined' && window.localStorage) {
      try {
        const saved = window.localStorage.getItem(storageKey)
        if (saved) {
          const parsed = Number(saved)
          if (!isNaN(parsed) && parsed >= min && parsed <= max) {
            return parsed
          }
        }
      } catch {}
    }
    return initialWidth
  })
  const [isResizing, setIsResizing] = useState<boolean>(false)

  const isDraggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(initialWidth)

  useEffect(() => {
    if (storageKey && typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(storageKey, String(width))
      } catch {}
    }
  }, [width, storageKey])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingRef.current = true
    setIsResizing(true)
    startXRef.current = e.clientX
    startWidthRef.current = width

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return
      const deltaX = moveEvent.clientX - startXRef.current
      const newWidth = Math.min(max, Math.max(min, startWidthRef.current + deltaX))
      setWidth(newWidth)
    }

    const handleMouseUp = () => {
      isDraggingRef.current = false
      setIsResizing(false)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setWidth((prev) => Math.max(min, prev - 20))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      setWidth((prev) => Math.min(max, prev + 20))
    }
  }

  return { width, isResizing, handleMouseDown, handleKeyDown }
}
