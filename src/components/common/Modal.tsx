import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'

export const MODAL_LAYER = {
  base: 'z-[100]',
  nested: 'z-[110]',
  approval: 'z-[120]',
} as const

export type ModalLayer = keyof typeof MODAL_LAYER

export const DEFAULT_PANEL_CLASS =
  'bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl max-w-2xl max-h-[85vh] flex flex-col overflow-hidden'

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  labelledById?: string
  layer?: ModalLayer
  align?: 'center' | 'end'
  /** Replaces defaults because conflicting Tailwind utilities do not reliably honor class order. */
  panelClassName?: string
  /** Prevents implicit rejection of approval prompts. */
  dismissible?: boolean
  children: React.ReactNode
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  labelledById,
  layer = 'base',
  align = 'center',
  panelClassName = DEFAULT_PANEL_CLASS,
  dismissible = true,
  children,
}) => {
  const panelRef = useRef<HTMLDivElement>(null)

  useLockBodyScroll(isOpen)

  useEffect(() => {
    if (!isOpen || !dismissible) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, dismissible, onClose])

  useEffect(() => {
    if (!isOpen) return
    panelRef.current?.focus()
  }, [isOpen])

  if (!isOpen) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledById}
      className={`fixed inset-0 ${MODAL_LAYER[layer]} flex bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150 ${
        align === 'end' ? 'justify-end' : 'items-center justify-center p-4'
      }`}
      onMouseDown={(event) => {
        // Avoid closing when a selection begins inside the panel and ends on the backdrop.
        if (dismissible && event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`w-full outline-none ${panelClassName}`}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}
