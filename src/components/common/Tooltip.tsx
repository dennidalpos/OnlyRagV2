import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import { useTranslation, type TranslationKey } from '../../i18n'
import type { it } from '../../i18n/locales/it'
import { registerTooltip, dismissTooltip } from '../../lib/tooltipLifecycle'

export type HelpKey = keyof typeof it.help

interface TooltipProps {
  helpKey: HelpKey
  params?: Record<string, string | number>
  children?: React.ReactElement<{ 'aria-describedby'?: string; tabIndex?: number }>
}

/** Shared informational help; operational errors and decisions stay in the visible UI. */
export function Tooltip({ helpKey, params, children }: TooltipProps) {
  const { t } = useTranslation()
  const id = useId()
  const anchor = useRef<HTMLSpanElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [focusTarget, setFocusTarget] = useState<HTMLElement | null>(null)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const text = t(`help.${helpKey}` as TranslationKey, params)

  const clearTimers = useCallback(() => {
    clearTimeout(closeTimer.current)
    clearTimeout(openTimer.current)
  }, [])
  const close = useCallback(() => {
    clearTimers()
    setOpen(false)
  }, [clearTimers])
  const show = (immediate = false) => {
    clearTimers()
    if (immediate) setOpen(true)
    else openTimer.current = setTimeout(() => setOpen(true), 250)
  }
  const leave = () => {
    clearTimeout(openTimer.current)
    closeTimer.current = setTimeout(() => {
      if (!anchor.current?.contains(document.activeElement)) setOpen(false)
    }, 150)
  }

  useEffect(() => clearTimers, [clearTimers])
  useLayoutEffect(() => {
    if (!open || !focusTarget || !anchor.current?.contains(focusTarget)) return
    const descriptions = (focusTarget.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
    if (descriptions.includes(id)) return
    focusTarget.setAttribute('aria-describedby', [...descriptions, id].join(' '))
    return () => {
      const remaining = (focusTarget.getAttribute('aria-describedby') || '').split(/\s+/).filter((value) => value && value !== id)
      if (remaining.length) focusTarget.setAttribute('aria-describedby', remaining.join(' '))
      else focusTarget.removeAttribute('aria-describedby')
    }
  }, [open, focusTarget, id])
  useEffect(() => {
    if (!open) return
    const unregister = registerTooltip(close)
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      dismissTooltip()
    }
    window.addEventListener('keydown', escape, true)
    return () => {
      unregister()
      window.removeEventListener('keydown', escape, true)
    }
  }, [open, close])

  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      if (!anchor.current || !bubble.current) return
      const rect = anchor.current.getBoundingClientRect()
      const size = bubble.current.getBoundingClientRect()
      const viewport = window.visualViewport
      const width = viewport?.width ?? window.innerWidth
      const height = viewport?.height ?? window.innerHeight
      const offsetX = viewport?.offsetLeft ?? 0
      const offsetY = viewport?.offsetTop ?? 0
      const left = Math.max(offsetX + 8, Math.min(rect.left, offsetX + width - size.width - 8))
      const below = rect.bottom + 8
      const top = below + size.height <= offsetY + height - 8 ? below : Math.max(offsetY + 8, rect.top - size.height - 8)
      setPosition({ left, top })
    }
    update()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : undefined
    if (bubble.current) observer?.observe(bubble.current)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    window.visualViewport?.addEventListener('resize', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [open, text])

  const trigger = children ? (
    React.cloneElement(children, {
      'aria-describedby': [children.props['aria-describedby'], open ? id : undefined].filter(Boolean).join(' ') || undefined,
      ...(typeof children.type === 'string' && !['button', 'input', 'select', 'textarea', 'a'].includes(children.type)
        ? { tabIndex: children.props.tabIndex ?? 0 }
        : {}),
    })
  ) : (
    <button
      type="button"
      aria-label={t('help.label')}
      aria-describedby={open ? id : undefined}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      className="inline-flex shrink-0 p-1 rounded text-slate-400 hover:text-cyan-300 focus-ring"
    >
      <Info aria-hidden="true" className="w-3.5 h-3.5" />
    </button>
  )
  const host = anchor.current?.closest('[data-tooltip-scope]')?.querySelector('[data-tooltip-layer]') ?? document.body

  return (
    <span
      ref={anchor}
      className="inline-flex align-middle max-w-full"
      onMouseEnter={() => show()}
      onMouseLeave={leave}
      onFocus={(event) => {
        setFocusTarget(event.target as HTMLElement)
        show(true)
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close()
      }}
    >
      {trigger}
      {open &&
        createPortal(
          <div
            ref={bubble}
            id={id}
            role="tooltip"
            onMouseEnter={clearTimers}
            onMouseLeave={leave}
            className="fixed z-[200] w-max max-w-[min(24rem,calc(100vw-16px))] max-h-[calc(100vh-16px)] overflow-y-auto whitespace-pre-line break-words rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-xs font-normal leading-relaxed text-slate-200 shadow-xl"
            style={position}
          >
            {text}
          </div>,
          host,
        )}
    </span>
  )
}
