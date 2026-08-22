import React from 'react'
import { Plus, Sliders, X, FileText, Sparkles, ChevronRight, Cpu, History } from 'lucide-react'
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
  onOpenDiagnosticsModal?: () => void
  onOpenPromptHistorySearch?: () => void
  autoInstallHubSkills?: 'disabled' | 'prompt' | 'auto'
  onToggleAutoInstallSkills?: () => void
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
  onOpenDiagnosticsModal,
  onOpenPromptHistorySearch,
  autoInstallHubSkills = 'auto',
  onToggleAutoInstallSkills,
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
        className={`px-2.5 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all focus-ring active:scale-95 cursor-pointer ${
          isOpen || attachedDocIds.size > 0
            ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/80 shadow-sm'
            : 'bg-slate-900/90 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200'
        }`}
      >
        <Plus className={`w-3.5 h-3.5 ${isOpen ? 'rotate-45' : ''} transition-transform text-cyan-400`} />
        <span className="text-[11px] font-medium">{t('chat.toolsButton')}</span>
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
              className="p-1 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 focus-ring cursor-pointer"
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
                  className="text-[9px] text-cyan-400 hover:underline cursor-pointer"
                >
                  {t('common.clear')}
                </button>
              )}
            </div>
            <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
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
                      className={`w-full text-left p-1.5 rounded-lg text-xs flex items-center justify-between transition-colors cursor-pointer ${
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

          {/* Section 2: Studio Tools & Modals */}
          <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Strumenti Studio</div>

            {onOpenPromptModal && (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onOpenPromptModal()
                }}
                className="w-full p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800/80 rounded-xl text-left flex items-center justify-between text-xs text-slate-300 hover:text-cyan-300 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Sliders className="w-3.5 h-3.5 text-cyan-400" /> {t('common.systemPrompt')}
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
            )}

            {onOpenSkillHubModal && (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onOpenSkillHubModal()
                }}
                className="w-full p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800/80 rounded-xl text-left flex items-center justify-between text-xs text-slate-300 hover:text-cyan-300 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> {t('skills.hubTitle')}
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
            )}

            {onOpenDiagnosticsModal && (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onOpenDiagnosticsModal()
                }}
                className="w-full p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800/80 rounded-xl text-left flex items-center justify-between text-xs text-slate-300 hover:text-cyan-300 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Cpu className="w-3.5 h-3.5 text-cyan-400" /> Diagnostica & Toolchain
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
            )}

            {onOpenPromptHistorySearch && (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onOpenPromptHistorySearch()
                }}
                className="w-full p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800/80 rounded-xl text-left flex items-center justify-between text-xs text-slate-300 hover:text-cyan-300 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <History className="w-3.5 h-3.5 text-cyan-400" /> Ricerca Storico Prompt
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
            )}

            {/* Section 3: Auto-Discovery Skill Toggle */}
            {onToggleAutoInstallSkills && (
              <div className="pt-2 border-t border-slate-800/80 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-cyan-400" /> Auto-Skill Discovery
                  </span>
                  <button
                    type="button"
                    onClick={onToggleAutoInstallSkills}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all cursor-pointer ${
                      autoInstallHubSkills === 'auto'
                        ? 'bg-cyan-500 text-slate-950 shadow-sm'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {autoInstallHubSkills === 'auto' ? 'ON' : 'OFF'}
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 leading-tight">
                  {autoInstallHubSkills === 'auto'
                    ? 'Installa e carica automaticamente le skill utili durante i task.'
                    : 'Auto-discovery delle skill disattivato.'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
