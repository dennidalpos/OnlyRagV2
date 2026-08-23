import React, { useEffect, useRef, useState } from 'react'
import { Trash2, Check, X, type LucideIcon } from 'lucide-react'
import { useTranslation } from '../../i18n'

/**
 * The app's single way to confirm a destructive action: the action's own button turns into a
 * confirm/cancel pair in the space it already occupies.
 *
 * Destructive confirmation had four different shapes — this in-place pattern for documents, a
 * full-screen dialog for removing a project, the browser's native `confirm()` for skills, hubs
 * and Ollama models, and nothing at all for sessions, which deleted on the first click. This
 * is the document pattern, extracted so every module answers the question the same way.
 *
 * A dialog is the wrong instrument here. It steals the whole screen to ask about a single row,
 * hides the very item being deleted behind its own backdrop, and needs an overlay, a portal
 * and a scroll lock to behave — for a question that fits in two buttons.
 */

export interface InlineDestructiveConfirmProps {
  onConfirm: () => void
  /** Names the target for screen readers, e.g. the filename or project name. */
  itemLabel: string
  /**
   * One short line shown beside the confirm buttons — for consequences the user cannot infer,
   * such as removing a project leaving its files on disk untouched.
   */
  hint?: string
  /** Tailwind sizing for the icons; defaults suit a dense list row. */
  iconClassName?: string
  className?: string
  /** Trigger icon. Defaults to a trash can; pass another for a destructive action that is not
   *  a deletion, such as resetting a locally edited skill back to its published version. */
  icon?: LucideIcon
  /** Tooltip and accessible verb for the trigger. Defaults to the shared "delete" label. */
  actionLabel?: string
}

export const InlineDestructiveConfirm: React.FC<InlineDestructiveConfirmProps> = ({
  onConfirm,
  itemLabel,
  hint,
  iconClassName = 'w-3.5 h-3.5',
  className = '',
  icon: Icon = Trash2,
  actionLabel,
}) => {
  const { t } = useTranslation()
  const triggerLabel = actionLabel || t('common.delete')
  const [isConfirming, setIsConfirming] = useState(false)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isConfirming) return
    confirmButtonRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setIsConfirming(false)
      }
    }
    // Capture phase: an ancestor dropdown or modal also listens for Escape, and the first
    // press must back out of the confirmation rather than close the container around it.
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isConfirming])

  if (!isConfirming) {
    return (
      <button
        type="button"
        onClick={(event) => {
          // Rows are usually clickable themselves (select document, switch project).
          event.stopPropagation()
          setIsConfirming(true)
        }}
        title={triggerLabel}
        aria-label={`${triggerLabel} ${itemLabel}`}
        className={`p-1.5 hover:bg-rose-950/80 rounded-lg text-slate-400 hover:text-rose-400 transition-colors focus-ring shrink-0 ${className}`}
      >
        <Icon className={iconClassName} />
      </button>
    )
  }

  return (
    <div
      className={`flex items-center gap-1.5 shrink-0 ${className}`}
      onClick={(event) => event.stopPropagation()}
    >
      {hint && <span className="text-[9px] text-slate-400 leading-tight max-w-[11rem] text-right">{hint}</span>}
      <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
        <button
          ref={confirmButtonRef}
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setIsConfirming(false)
            onConfirm()
          }}
          title={t('common.confirm')}
          aria-label={`${t('common.confirm')} — ${itemLabel}`}
          className="p-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition-colors focus-ring active:scale-95"
        >
          <Check className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setIsConfirming(false)
          }}
          title={t('common.cancel')}
          aria-label={t('common.cancel')}
          className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors focus-ring"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}
