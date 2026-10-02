import React, { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { isTopModal, registerModal } from '../../lib/modalFocus'

export const MODAL_LAYER = {
  base: 'z-[100]',
  nested: 'z-[110]',
  approval: 'z-[120]',
} as const

export type ModalLayer = keyof typeof MODAL_LAYER

export const DEFAULT_PANEL_CLASS = 'bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl max-w-2xl max-h-[85vh] flex flex-col overflow-hidden'

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
  const rootRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const dismissibleRef = useRef(dismissible)
  closeRef.current = onClose
  dismissibleRef.current = dismissible

  useLockBodyScroll(isOpen)

  useLayoutEffect(() => {
    if (!isOpen || !rootRef.current || !panelRef.current) return
    return registerModal(
      rootRef.current,
      panelRef.current,
      { base: 0, nested: 1, approval: 2 }[layer],
      () => dismissibleRef.current,
      () => closeRef.current(),
    )
  }, [isOpen, layer])

  if (!isOpen) return null

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledById}
      className={`fixed inset-0 ${MODAL_LAYER[layer]} flex bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150 ${
        align === 'end' ? 'justify-end' : 'items-center justify-center p-4'
      }`}
      onMouseDown={(event) => {
        // Avoid closing when a selection begins inside the panel and ends on the backdrop.
        if (dismissible && isTopModal(rootRef.current) && event.target === event.currentTarget) onClose()
      }}
    >
      <div ref={panelRef} tabIndex={-1} className={`w-full outline-none ${panelClassName}`}>
        {children}
      </div>
    </div>,
    document.body,
  )
}
