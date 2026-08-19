import React, { useState } from 'react'
import { Clock, Check, Edit2, Trash2 } from 'lucide-react'
import { QueuedPrompt } from '../../hooks/useCodingAgent'
import { useTranslation } from '../../i18n'

interface PromptQueueCardProps {
  promptQueue: QueuedPrompt[]
  onRemoveFromQueue?: (id: string) => void
  onEditPromptInQueue?: (id: string, newPrompt: string) => void
}

export const PromptQueueCard: React.FC<PromptQueueCardProps> = ({
  promptQueue,
  onRemoveFromQueue,
  onEditPromptInQueue,
}) => {
  const { t } = useTranslation()
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null)
  const [editingQueueText, setEditingQueueText] = useState<string>('')

  if (promptQueue.length === 0) return null

  return (
    <div className="mx-3 mb-1 p-2.5 bg-[#121826] border border-slate-800 rounded-xl space-y-2 text-xs shrink-0">
      <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
        <span className="flex items-center gap-1.5 text-cyan-400">
          <Clock className="w-3.5 h-3.5" /> {t('coding.queuedPrompts', { count: promptQueue.length })}
        </span>
        <span className="text-[10px] text-slate-400 font-mono">{t('common.status')}</span>
      </div>

      <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
        {promptQueue.map((item, idx) => {
          const isEditing = editingQueueId === item.id
          return (
            <div
              key={item.id}
              className="p-2 bg-[#090d16] border border-slate-800/80 rounded-lg flex items-center justify-between gap-2 text-xs"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono text-cyan-400 font-bold shrink-0">
                  #{idx + 1}
                </span>
                {isEditing ? (
                  <input
                    type="text"
                    value={editingQueueText}
                    onChange={(e) => setEditingQueueText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        onEditPromptInQueue?.(item.id, editingQueueText)
                        setEditingQueueId(null)
                      } else if (e.key === 'Escape') {
                        setEditingQueueId(null)
                      }
                    }}
                    className="flex-1 bg-slate-950 border border-cyan-500/50 rounded px-2 py-0.5 text-slate-100 text-xs outline-none font-sans"
                    autoFocus
                  />
                ) : (
                  <span className="truncate text-slate-300 text-[11px] font-sans" title={item.prompt}>
                    {item.prompt}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {isEditing ? (
                  <button
                    type="button"
                    onClick={() => {
                      onEditPromptInQueue?.(item.id, editingQueueText)
                      setEditingQueueId(null)
                    }}
                    className="p-1 hover:bg-slate-800 text-emerald-400 rounded"
                    title={t('common.save')}
                  >
                    <Check className="w-3 h-3" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingQueueId(item.id)
                      setEditingQueueText(item.prompt)
                    }}
                    className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded"
                    title={t('coding.editQueuePrompt')}
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onRemoveFromQueue?.(item.id)}
                  className="p-1 hover:bg-rose-950/80 text-slate-400 hover:text-rose-400 rounded transition-colors"
                  title={t('coding.removeFromQueue')}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
