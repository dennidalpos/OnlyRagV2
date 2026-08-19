import { useState, useRef } from 'react'

/**
 * Drag-to-resize logic for a horizontally split panel (mouse drag on a divider, plus
 * arrow-key nudging for accessibility). Owns only the width/isResizing state and the
 * event wiring; the divider's markup stays with its caller since exact styling differs
 * per usage.
 */
export function useResizablePanel(initialWidth: number, min: number, max: number) {
  const [width, setWidth] = useState<number>(initialWidth)
  const [isResizing, setIsResizing] = useState<boolean>(false)

  const isDraggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(initialWidth)

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
