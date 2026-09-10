import React, { useEffect, useRef, useState } from 'react'
import { Trash2, Check, X, type LucideIcon } from 'lucide-react'
import { useTranslation } from '../../i18n'

/** In-place confirmation that keeps the destructive target visible. */

export interface InlineDestructiveConfirmProps {
  onConfirm: () => void
  /** Accessible target name. */
  itemLabel: string
  /** Consequence not evident from the action. */
  hint?: string
  iconClassName?: string
  className?: string
  /** Alternative destructive-action icon. */
  icon?: LucideIcon
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
    // Let Escape cancel confirmation before ancestor handlers close their container.
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isConfirming])

  if (!isConfirming) {
    return (
      <button
        type="button"
        onClick={(event) => {
          // Prevent the row action while entering confirmation.
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
