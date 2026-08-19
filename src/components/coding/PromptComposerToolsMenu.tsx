import React from 'react'
import { Plus, Sliders, X, FileText, Sparkles, ChevronRight } from 'lucide-react'
import { IngestedDocument } from '../../types'
import { useTranslation } from '../../i18n'

interface PromptComposerToolsMenuProps {
  isOpen: boolean
  onToggle: () => void
  onClose: () => void
  menuRef: React.RefObject<HTMLDivElement | null>
  ingestedDocs: IngestedDocument[]
  attachedDocIds: Set<string>
  onToggleAttachDoc: (docId: string) => void
  onOpenSkillHubModal?: () => void
  onOpenPromptModal?: () => void
}

export const PromptComposerToolsMenu: React.FC<PromptComposerToolsMenuProps> = ({
  isOpen,
  onToggle,
  onClose,
  menuRef,
  ingestedDocs,
  attachedDocIds,
  onToggleAttachDoc,
  onOpenSkillHubModal,
  onOpenPromptModal,
}) => {
  const { t } = useTranslation()

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-label={t('chat.toolsTitle')}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        title={t('chat.toolsTitle')}
        className={`px-2 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all focus-ring active:scale-95 ${
          isOpen || attachedDocIds.size > 0
            ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/80 shadow-sm'
            : 'bg-slate-900/90 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200'
        }`}
      >
        <Plus className={`w-3.5 h-3.5 ${isOpen ? 'rotate-45' : ''} transition-transform text-cyan-400`} />
        <span className="text-[11px]">{t('chat.toolsButton')}</span>
        {attachedDocIds.size > 0 && (
          <span className="px-1.5 py-0.2 rounded-full bg-cyan-500 text-slate-950 font-bold text-[9px]">
            {attachedDocIds.size}
          </span>
        )}
      </button>

      {/* Contextual Popover Panel */}
      {isOpen && (
        <div
          ref={menuRef}
          role="dialog"
          aria-modal="false"
          aria-label={t('chat.toolsTitle')}
          className="absolute bottom-full mb-2 left-0 w-72 bg-slate-900 border border-slate-800 rounded-2xl p-3 shadow-2xl space-y-3 z-30 font-sans animate-in fade-in"
        >
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" /> {t('chat.toolsTitle')}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="p-1 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 focus-ring"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Section 1: RAG Documents Attachment */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
              <span>{t('chat.contextTitle', { selected: attachedDocIds.size, total: ingestedDocs.length })}</span>
              {attachedDocIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => attachedDocIds.forEach((id) => onToggleAttachDoc(id))}
                  className="text-[9px] text-cyan-400 hover:underline"
                >
                  {t('common.clear')}
                </button>
              )}
            </div>
            <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
              {ingestedDocs.length === 0 ? (
                <div className="text-[11px] text-slate-400 italic p-1">{t('chat.noDocsIndexed')}</div>
              ) : (
                ingestedDocs.map((doc) => {
                  const isAttached = attachedDocIds.has(doc.id)
                  return (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => onToggleAttachDoc(doc.id)}
                      className={`w-full text-left p-1.5 rounded-lg text-xs flex items-center justify-between transition-colors ${
                        isAttached ? 'bg-cyan-950 text-cyan-200 border border-cyan-800/60' : 'hover:bg-slate-800 text-slate-400'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <FileText className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        <span className="truncate text-[11px]">{doc.filename}</span>
                      </div>
                      <span className="text-[9px] font-mono shrink-0">{isAttached ? '✓' : '+'}</span>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {/* Section 2: Moduli & System Prompt */}
          <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('common.actions')}</div>
            {onOpenSkillHubModal && (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onOpenSkillHubModal()
                }}
                className="w-full p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800/80 rounded-xl text-left flex items-center justify-between text-xs text-slate-300 hover:text-cyan-300 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> {t('skills.hubTitle')}
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
            )}
            {onOpenPromptModal && (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onOpenPromptModal()
                }}
                className="w-full p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800/80 rounded-xl text-left flex items-center justify-between text-xs text-slate-300 hover:text-cyan-300 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Sliders className="w-3.5 h-3.5 text-cyan-400" /> {t('chat.configurePrompt')}
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
