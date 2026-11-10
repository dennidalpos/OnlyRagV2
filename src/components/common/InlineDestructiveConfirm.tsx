import React, { useId, useState } from 'react'
import { Trash2, Check, X, type LucideIcon } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { Modal } from './Modal'

/** Confirmation rendered outside scrollable cards so actions remain fully visible. */

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
  const titleId = useId()

  return (
    <>
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
      <Modal
        isOpen={isConfirming}
        onClose={() => setIsConfirming(false)}
        labelledById={titleId}
        layer="nested"
        panelClassName="max-w-sm bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-5 space-y-4"
      >
        <h2 id={titleId} className="text-sm font-semibold text-slate-100">
          {triggerLabel} {itemLabel}?
        </h2>
        {hint && <p className="text-xs text-slate-300 leading-relaxed">{hint}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setIsConfirming(false)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs focus-ring flex items-center gap-1"
          >
            <X className="w-3 h-3" />
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setIsConfirming(false)
              onConfirm()
            }}
            title={t('common.confirm')}
            aria-label={`${t('common.confirm')} — ${itemLabel}`}
            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition-colors focus-ring active:scale-95 text-xs flex items-center gap-1"
          >
            <Check className="w-3 h-3" />
            {t('common.confirm')}
          </button>
        </div>
      </Modal>
    </>
  )
}
