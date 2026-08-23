import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'

/**
 * The single overlay primitive every modal in the app renders through.
 *
 * Each modal used to build its own overlay, and they had drifted apart: five overlay
 * opacities, two tints, two blur levels, five hand-assigned z-index values, Escape handled in
 * 9 of 15, and no portal or scroll lock anywhere. The missing scroll lock is what let the
 * panel behind a dialog keep its visible, scrollable scrollbar.
 *
 * Rendering through a portal on document.body also makes the overlay independent of wherever
 * the modal happens to sit in the component tree, so no ancestor's `overflow`, `transform` or
 * `backdrop-filter` can clip it or trap its stacking context.
 */

/** Layers, so no caller hand-picks a z-index again. Base dialogs, then what they open on top. */
export const MODAL_LAYER = {
  base: 'z-[100]',
  nested: 'z-[110]',
  approval: 'z-[120]',
} as const

export type ModalLayer = keyof typeof MODAL_LAYER

/** Standard dialog chrome. Callers needing a different width, height or accent replace it whole. */
export const DEFAULT_PANEL_CLASS =
  'bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl max-w-2xl max-h-[85vh] flex flex-col overflow-hidden'

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  /** Rendered as the dialog's accessible name. */
  labelledById?: string
  /** Stacking layer; `nested` for a dialog opened from another, `approval` for blocking prompts. */
  layer?: ModalLayer
  /** `center` for a dialog, `end` for a side drawer that fills the viewport height. */
  align?: 'center' | 'end'
  /**
   * The panel's complete class string, REPLACING the default chrome rather than appending to
   * it — Tailwind resolves conflicting utilities by stylesheet order, not by the order they
   * appear in a className, so appending "max-h-[90vh]" to a default "max-h-[85vh]" would not
   * reliably win. Callers that need a different width, height or accent pass the whole string.
   */
  panelClassName?: string
  /**
   * Approval-style dialogs must be answered, not dismissed: clicking the backdrop or pressing
   * Escape would read as an implicit "no" to a question the user never saw resolved.
   */
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
    // Move focus into the dialog so keyboard users are not left behind it, and so Escape
    // reaches the handler above without the user having to click first.
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
        // mousedown, not click: a click that STARTED inside the panel and ended on the backdrop
        // (a text selection dragged past the edge) would otherwise close the dialog.
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
