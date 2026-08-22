import React, { useState, useRef, useEffect } from 'react'
import {
  MessageSquare,
  Bot,
  User,
  FileText,
  Copy,
  Check,
  RefreshCw,
  RotateCcw,
  Sliders,
  Sparkles,
  Loader2,
  ArrowUp,
  Plus,
  X,
  ChevronRight,
  Square,
  AlertTriangle,
  ArrowDown,
  GripVertical,
  History,
  Trash2,
  Edit2,
  Clock,
} from 'lucide-react'
import { AppSettings, DiagnosticsData } from '../../types'
import { SystemPromptModal } from '../common/SystemPromptModal'
import { QuickModelSelector } from '../common/QuickModelSelector'
import { useChatEngine } from '../../hooks/useChatEngine'
import { useToast } from '../common/Toast'
import { useTranslation } from '../../i18n'
import { useResizablePanel } from '../../hooks/useResizablePanel'

interface ChatViewProps {
  settings: AppSettings
  diagnostics: DiagnosticsData | null
  onUpdateSettings?: (newSettings: Partial<AppSettings>) => void
}

export const ChatView: React.FC<ChatViewProps> = ({ settings, diagnostics, onUpdateSettings }) => {
  const { t } = useTranslation()
  const c = useChatEngine(settings, diagnostics)
  const toast = useToast()
  const {
    width: sidebarWidth,
    isResizing: isSidebarResizing,
    handleMouseDown: handleSidebarMouseDown,
    handleKeyDown: handleSidebarKeyDown,
  } = useResizablePanel(288, 200, 480, 'onlyrag_chat_sidebar_width')
  const toolsMenuRef = useRef<HTMLDivElement>(null)
  const resetConfirmRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [showToolsMenu, setShowToolsMenu] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [copiedCitationIdx, setCopiedCitationIdx] = useState<string | null>(null)
  const [sidebarTab, setSidebarTab] = useState<'context' | 'history'>('context')
  const [editingConvId, setEditingConvId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  // Automatically maintain and restore focus on the prompt input field
  useEffect(() => {
    if (!c.isGenerating) {
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [c.isGenerating, c.activeConversationId])

  // Close tools and reset popovers on click outside or Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setShowToolsMenu(false)
      }
      if (resetConfirmRef.current && !resetConfirmRef.current.contains(e.target as Node)) {
        setShowResetConfirm(false)
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowToolsMenu(false)
        setShowResetConfirm(false)
        setEditingConvId(null)
      }
    }

    if (showToolsMenu || showResetConfirm) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showToolsMenu, showResetConfirm])

  const handleStartRename = (id: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingConvId(id)
    setEditingTitle(currentTitle)
  }

  const handleSaveRename = (id: string, e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (editingTitle.trim()) {
      c.renameConversation(id, editingTitle.trim())
    }
    setEditingConvId(null)
  }

  return (
    <div className="flex-1 h-full flex flex-col bg-slate-950 overflow-hidden select-text">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 bg-slate-900/80 flex items-center justify-between z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="font-bold text-slate-100 text-sm tracking-wide">{t('chat.headerTitle')}</h1>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Autoscroll Toggle Button */}
          <button
            type="button"
            onClick={() => c.setAutoScroll(!c.autoScroll)}
            aria-pressed={c.autoScroll}
            aria-label={c.autoScroll ? t('common.autoscrollOnAria') : t('common.autoscrollOffAria')}
            title={c.autoScroll ? t('common.autoscrollOnTitle') : t('common.autoscrollOffTitle')}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all focus-ring active:scale-95 ${
              c.autoScroll
                ? 'bg-cyan-950/90 text-cyan-300 border border-cyan-500/60 shadow-sm'
                : 'bg-slate-900 border border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            <ArrowDown className={`w-3.5 h-3.5 ${c.autoScroll ? 'text-cyan-400' : 'text-slate-400'}`} />
            <span className="text-[11px] hidden sm:inline font-medium">Autoscroll</span>
          </button>

          {/* Quick Chat Model Selector with Fallback */}
          <QuickModelSelector
            currentModel={settings.chatModel || settings.defaultModel || 'llama3.2'}
            fallbackModel={settings.chatFallbackModel}
            installedModels={diagnostics?.ollama?.models || []}
            presetOptions={['llama3.2:3b', 'llama3.1:8b', 'qwen2.5:7b', 'mistral:7b', 'gemma2:9b', 'phi3.5:3.8b']}
            onSelectModel={(newModel) => {
              onUpdateSettings?.({
                chatModel: newModel,
              })
            }}
            onSelectFallbackModel={(fallback) => {
              onUpdateSettings?.({
                chatFallbackModel: fallback,
              })
            }}
            icon={MessageSquare}
            featureLabel="RAG Chat"
            variant="purple"
          />
        </div>
      </div>

      {/* Main Split Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar: Context Documents & History */}
        <div
          style={{ width: `${sidebarWidth}px` }}
          className="border-r border-slate-800 bg-slate-900/40 p-3 space-y-3 flex flex-col shrink-0 overflow-hidden select-text"
        >
          {/* Sidebar Tab Switcher */}
          <div className="flex items-center p-1 bg-slate-950/80 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setSidebarTab('context')}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                sidebarTab === 'context'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/60 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Contesto ({c.selectedDocIds.size}/{c.documents.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab('history')}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                sidebarTab === 'history'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/60 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Storico ({c.conversations.length})</span>
            </button>
          </div>

          {/* Context Tab Content */}
          {sidebarTab === 'context' ? (
            <>
              <div className="flex items-center justify-between pb-1 border-b border-slate-800/80">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Documenti Vettorizzati
                </span>
                <button
                  type="button"
                  onClick={c.fetchDocuments}
                  aria-label={t('chat.refreshList')}
                  title={t('chat.refreshList')}
                  className="p-1 text-slate-400 hover:text-cyan-400 transition-colors rounded-lg focus-ring active:scale-95"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-1.5 pr-1" role="group" aria-label={t('chat.toolsTitle')}>
                {c.documents.length === 0 ? (
                  <div className="text-center py-8 text-xs text-slate-400 border border-dashed border-slate-800 rounded-xl p-4 leading-relaxed">
                    {t('chat.noDocsIndexed')} {t('chat.noDocsHint')}
                  </div>
                ) : (
                  c.documents.map((doc) => {
                    const isSelected = c.selectedDocIds.has(doc.id)
                    return (
                      <button
                        type="button"
                        key={doc.id}
                        onClick={() => c.toggleDocSelection(doc.id)}
                        aria-pressed={isSelected}
                        aria-label={`${doc.filename} (${isSelected ? t('common.active') : t('common.none')})`}
                        className={`w-full text-left p-2.5 rounded-xl border text-xs transition-all focus-ring active:scale-95 flex items-center justify-between ${
                          isSelected
                            ? 'bg-cyan-950/80 border-cyan-600/80 text-cyan-200 shadow-md shadow-cyan-950/40'
                            : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <FileText className={`w-4 h-4 shrink-0 ${isSelected ? 'text-cyan-400' : 'text-slate-400'}`} />
                          <span className="truncate font-medium" title={doc.filename}>{doc.filename}</span>
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                      </button>
                    )
                  })
                )}
              </div>
            </>
          ) : (
            /* History Tab Content */
            <>
              <div className="flex items-center justify-between pb-1 border-b border-slate-800/80">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  {t('chat.historyTitle')}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    c.handleNewChat()
                    toast.info(t('chat.newChatStarted'))
                  }}
                  className="px-2 py-1 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-[11px] rounded-lg flex items-center gap-1 transition-all active:scale-95 shadow-sm"
                  title={t('chat.newChat')}
                >
                  <Plus className="w-3 h-3" />
                  <span>Nuova</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                {c.conversations.length === 0 ? (
                  <div className="text-center py-8 text-xs text-slate-400 border border-dashed border-slate-800 rounded-xl p-4 leading-relaxed">
                    {t('chat.noConversations')}
                  </div>
                ) : (
                  c.conversations.map((conv) => {
                    const isActive = conv.id === c.activeConversationId
                    const isEditing = editingConvId === conv.id
                    return (
                      <div
                        key={conv.id}
                        onClick={() => {
                          if (!isEditing) {
                            c.loadConversation(conv.id)
                            toast.info(t('chat.conversationLoaded'))
                          }
                        }}
                        className={`group relative p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                          isActive
                            ? 'bg-cyan-950/80 border-cyan-600/80 text-cyan-200 shadow-md shadow-cyan-950/40'
                            : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                        }`}
                      >
                        {isEditing ? (
                          <form onSubmit={(e) => handleSaveRename(conv.id, e)} className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              value={editingTitle}
                              onChange={(e) => setEditingTitle(e.target.value)}
                              autoFocus
                              className="flex-1 px-2 py-1 bg-slate-950 border border-cyan-500 rounded-lg text-xs text-slate-100 focus:outline-none"
                            />
                            <button
                              type="submit"
                              className="p-1 bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded-md"
                              title={t('chat.saveTitle')}
                            >
                              <Check className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingConvId(null)}
                              className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </form>
                        ) : (
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-slate-200 truncate flex items-center gap-1.5" title={conv.title}>
                                <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                                <span className="truncate">{conv.title}</span>
                              </div>
                              <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-2">
                                <span className="flex items-center gap-1">
                                  <Clock className="w-2.5 h-2.5" />
                                  {new Date(conv.updatedAt || conv.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <span>• {conv.messages?.length || 0} msg</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={(e) => handleStartRename(conv.id, conv.title, e)}
                                className="p-1 text-slate-400 hover:text-cyan-300 hover:bg-slate-800 rounded transition-colors"
                                title={t('chat.renameConversation')}
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  c.deleteConversation(conv.id)
                                  toast.info(t('chat.conversationDeleted'))
                                }}
                                className="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded transition-colors"
                                title={t('chat.deleteConversation')}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </>
          )}
        </div>

        {/* Resizable Divider Handle */}
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-valuenow={sidebarWidth}
          aria-valuemin={200}
          aria-valuemax={480}
          aria-label={t('coding.resizePanels')}
          onMouseDown={handleSidebarMouseDown}
          onKeyDown={handleSidebarKeyDown}
          className={`w-1.5 hover:w-2 hover:bg-cyan-500 bg-slate-800/80 cursor-col-resize transition-all shrink-0 flex items-center justify-center group focus-ring ${
            isSidebarResizing ? 'bg-cyan-500 w-2 ring-2 ring-cyan-500/50' : ''
          }`}
          title={t('coding.resizePanels')}
        >
          <GripVertical className={`w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity ${isSidebarResizing ? 'opacity-100 text-slate-950' : ''}`} />
        </div>

        {/* Right: Messages & Input */}
        <div className={`flex-1 flex flex-col bg-slate-950 overflow-hidden min-w-0 ${isSidebarResizing ? 'pointer-events-none select-none' : ''}`}>
          <div
            ref={c.messagesContainerRef}
            onScroll={c.handleScroll}
            className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0 relative"
            aria-label={t('navigation.chat')}
          >
            {/* Floating Scroll-to-Bottom Button */}
            {c.isScrolledUp && (
              <button
                type="button"
                onClick={() => c.scrollToBottom(true)}
                className="sticky top-2 ml-auto z-20 px-3 py-1.5 rounded-full bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs shadow-xl flex items-center gap-1.5 transition-all active:scale-95"
                aria-label="Scorri fino in fondo"
              >
                <ArrowDown className="w-3.5 h-3.5" />
                <span>In fondo</span>
              </button>
            )}
            {c.messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 max-w-lg mx-auto space-y-4 font-sans select-none">
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-lg shadow-cyan-950/20">
                  <MessageSquare className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-100">{t('chat.emptyTitle')}</h2>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    {t('chat.emptySubtitle')}
                  </p>
                </div>

                <div className="w-full pt-2 space-y-2 text-left">
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider text-center">
                    {t('chat.quickStartTitle')}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {[
                      t('chat.quickStart1'),
                      t('chat.quickStart2'),
                      t('chat.quickStart3'),
                      t('chat.quickStart4'),
                    ].map((prompt, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => c.setInput(prompt)}
                        className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-850 border border-slate-800 hover:border-cyan-500/40 text-xs text-slate-300 hover:text-cyan-200 text-left transition-all focus-ring active:scale-98 leading-snug"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              c.messages.map((msg) => {
                const isUser = msg.sender === 'user'
                const isCopied = c.copiedMsgId === msg.id

                return (
                  <div
                    key={msg.id}
                    className={`flex gap-3 max-w-4xl ${isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
                  >
                    {/* Avatar Icon */}
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
                        isUser
                          ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4 text-cyan-400" />}
                    </div>

                    {/* Message Bubble */}
                    <div className={`space-y-2 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
                      <div
                        className={`p-4 rounded-2xl text-xs leading-relaxed border select-text ${
                          isUser
                            ? 'bg-cyan-950/80 border-cyan-800/80 text-cyan-100 rounded-tr-sm shadow-md shadow-cyan-950/30'
                            : 'bg-slate-900/90 border-slate-800 text-slate-200 rounded-tl-sm shadow-md shadow-slate-950/40'
                        }`}
                      >
                        {/* Message Header (Timestamp & Copy) */}
                        <div className="flex items-center justify-between gap-4 mb-2 pb-1.5 border-b border-slate-800/60 text-[10px] text-slate-400">
                          <span className="font-semibold uppercase tracking-wider">
                            {isUser ? 'Tu' : 'Assistente AI RAG'} • {msg.timestamp}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              c.handleCopyMessage(msg.id, msg.text)
                              toast.info(t('chat.msgCopied'))
                            }}
                            className="p-1 hover:text-slate-200 rounded transition-colors focus-ring cursor-pointer"
                            title={t('chat.copyMsg')}
                            aria-label={t('chat.copyMsg')}
                          >
                            {isCopied ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>

                        {/* Message Text / Streaming State */}
                        {msg.text ? (
                          <div className="whitespace-pre-wrap font-sans text-slate-200 selection:bg-cyan-500/30 selection:text-cyan-100">
                            {msg.text}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-cyan-400 animate-pulse py-1">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span className="text-[11px] font-medium">{t('chat.generating')}</span>
                          </div>
                        )}

                        {/* Citations and Source Verification Cards */}
                        {msg.sources && msg.sources.length > 0 && (() => {
                          const uniqueDocNames = Array.from(new Set(msg.sources.map((s) => s.docName || 'Documento')))
                          const uniqueDocsCount = uniqueDocNames.length
                          const chunksCount = msg.sources.length
                          const headerLabel = uniqueDocsCount === 1
                            ? `${chunksCount} ${chunksCount === 1 ? 'estratto rilevante' : 'estratti rilevanti'} da "${uniqueDocNames[0]}"`
                            : `${chunksCount} estratti da ${uniqueDocsCount} documenti`

                          return (
                            <div className="mt-3 pt-3 border-t border-slate-800/80 space-y-2">
                              <div className="text-[11px] font-bold text-cyan-300 flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <Sparkles className="w-3 h-3 text-cyan-400" />
                                  <span>Fonti &amp; Citazioni ({headerLabel})</span>
                                </div>
                              </div>
                              <div className="grid grid-cols-1 gap-1.5">
                                {msg.sources.map((src, idx) => (
                                  <div
                                    key={idx}
                                    className="p-2 bg-slate-950/70 border border-slate-800/80 rounded-xl space-y-1"
                                  >
                                    <div className="flex items-center justify-between text-[10px]">
                                      <div className="flex items-center gap-1.5 truncate max-w-[280px]">
                                        <span className="px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-800/60 text-cyan-300 font-mono text-[9px] font-bold">
                                          Estratto {idx + 1}
                                        </span>
                                        <span className="font-semibold text-slate-300 truncate">
                                          {src.docName}
                                        </span>
                                        {src.sectionHeader && (
                                          <span className="text-slate-400 text-[9px] truncate">
                                            ({src.sectionHeader})
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <span className="text-cyan-400 font-mono text-[9px] px-1.5 py-0.2 bg-cyan-950/80 border border-cyan-800/50 rounded-full">
                                          {t('chat.relevance')}: {(src.score * 100).toFixed(0)}%
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            navigator.clipboard.writeText(src.snippet)
                                            setCopiedCitationIdx(`${msg.id}-${idx}`)
                                            toast.info(t('chat.citationCopied'))
                                            setTimeout(() => setCopiedCitationIdx(null), 2000)
                                          }}
                                          className="p-0.5 text-slate-400 hover:text-slate-200 transition-colors focus-ring rounded cursor-pointer"
                                          title={t('chat.copyCitation')}
                                          aria-label={t('chat.copyCitation')}
                                        >
                                          {copiedCitationIdx === `${msg.id}-${idx}` ? (
                                            <Check className="w-2.5 h-2.5 text-emerald-400" />
                                          ) : (
                                            <Copy className="w-2.5 h-2.5" />
                                          )}
                                        </button>
                                      </div>
                                    </div>
                                    <p className="text-[10px] text-slate-400 font-sans italic line-clamp-2 leading-relaxed">
                                      "{src.snippet}"
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )
                        })()}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
            <div ref={c.chatBottomRef} />
          </div>

          {/* Mention Auto-Complete Popover */}
          {c.showMentions && c.filteredMentions.length > 0 && (
            <div
              role="listbox"
              aria-label="Document mentions"
              className="absolute bottom-20 left-6 z-30 w-72 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden font-sans animate-in fade-in"
            >
              <div className="p-2 border-b border-slate-800 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-3 h-3 text-cyan-400" />
                <span>Collega Contesto Documento (@)</span>
              </div>
              <div className="max-h-48 overflow-y-auto p-1 space-y-1">
                {c.filteredMentions.map((doc) => (
                  <button
                    type="button"
                    key={doc.id}
                    onClick={() => c.selectMentionDoc(doc)}
                    role="option"
                    aria-selected={c.selectedDocIds.has(doc.id)}
                    className="w-full text-left p-2 rounded-xl hover:bg-slate-800 text-xs text-slate-300 hover:text-cyan-200 flex items-center gap-2 transition-colors focus-ring"
                  >
                    <FileText className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span className="truncate">{doc.filename}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Bottom Chat Input Form Container */}
          <div className="p-4 border-t border-slate-800 bg-slate-900/60 shrink-0">
            <div className="max-w-4xl mx-auto space-y-2">
              <form onSubmit={c.handleSendMessage} className="space-y-2">
                {/* Main Input Text Field */}
                <div className="relative flex items-center">
                  <input
                    ref={inputRef}
                    type="text"
                    value={c.input}
                    onChange={c.handleInputChange}
                    placeholder={t('chat.inputPlaceholder')}
                    aria-label={t('chat.inputPlaceholder')}
                    disabled={c.isGenerating}
                    className="w-full pl-4 pr-10 py-3 bg-slate-950 border border-slate-800 rounded-2xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/80 transition-all font-sans disabled:opacity-50"
                  />
                </div>

                {/* Controls Bar Below Input */}
                <div className="flex items-center justify-between text-xs px-1">
                  {/* Left: Tools & System Prompt Trigger */}
                  <div className="flex items-center gap-2 relative">
                    <button
                      type="button"
                      onClick={() => setShowToolsMenu(!showToolsMenu)}
                      aria-label={t('chat.toolsTitle')}
                      aria-haspopup="dialog"
                      aria-expanded={showToolsMenu}
                      title={t('chat.toolsTitle')}
                      className={`px-2 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all focus-ring active:scale-95 ${
                        showToolsMenu || c.selectedDocIds.size > 0
                          ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/80 shadow-sm'
                          : 'bg-slate-900/90 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Plus className={`w-3.5 h-3.5 ${showToolsMenu ? 'rotate-45' : ''} transition-transform text-cyan-400`} />
                      <span className="text-[11px]">{t('chat.toolsButton')}</span>
                      {c.selectedDocIds.size > 0 && (
                        <span className="px-1.5 py-0.2 rounded-full bg-cyan-500 text-slate-950 font-bold text-[9px]">
                          {c.selectedDocIds.size}
                        </span>
                      )}
                    </button>

                    {/* Popover Panel */}
                    {showToolsMenu && (
                      <div
                        ref={toolsMenuRef}
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
                            onClick={() => setShowToolsMenu(false)}
                            aria-label={t('common.close')}
                            className="p-1 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 focus-ring"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="text-[11px] text-slate-400">
                          {c.documents.length > 0
                            ? t('chat.contextTitle', { selected: c.selectedDocIds.size, total: c.documents.length })
                            : t('chat.noDocsHint')}
                        </div>

                        {/* System Prompt Trigger */}
                        <div>
                          <button
                            type="button"
                            onClick={() => {
                              setShowToolsMenu(false)
                              c.setIsPromptModalOpen(true)
                            }}
                            className="w-full p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800/80 rounded-xl text-left flex items-center justify-between text-xs text-slate-300 hover:text-cyan-300 transition-colors focus-ring"
                          >
                            <span className="flex items-center gap-2">
                              <Sliders className="w-3.5 h-3.5 text-cyan-400" /> {t('chat.configurePrompt')}
                            </span>
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right: Quick actions, states, reset, send */}
                  <div className="flex items-center gap-2 relative">
                    {/* Reset Nuova Chat Mini Button */}
                    <button
                      type="button"
                      onClick={() => {
                        if (c.messages.length > 0) {
                          setShowResetConfirm(true)
                        } else {
                          c.handleNewChat()
                          toast.info(t('chat.newChatStarted'))
                        }
                      }}
                      aria-label={t('chat.newChat')}
                      title={t('chat.newChat')}
                      className="p-1.5 text-slate-400 hover:text-cyan-300 hover:bg-slate-800/80 rounded-lg transition-colors focus-ring"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>

                    {/* Reset Confirmation Tooltip Popover */}
                    {showResetConfirm && (
                      <div
                        ref={resetConfirmRef}
                        role="alertdialog"
                        aria-labelledby="reset-chat-title"
                        className="absolute bottom-full mb-2 right-0 bg-slate-900 border border-slate-700 rounded-xl p-2.5 shadow-2xl z-40 w-48 space-y-2 font-sans animate-in fade-in"
                      >
                        <div id="reset-chat-title" className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span>{t('chat.resetConfirmTitle')}</span>
                        </div>
                        <div className="flex items-center gap-1.5 justify-end">
                          <button
                            type="button"
                            onClick={() => setShowResetConfirm(false)}
                            className="px-2 py-1 text-[10px] text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-750 rounded-md transition-colors focus-ring"
                          >
                            {t('chat.resetConfirmCancel')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              c.handleNewChat()
                              setShowResetConfirm(false)
                              toast.info(t('chat.chatCleared'))
                            }}
                            className="px-2 py-1 text-[10px] text-slate-950 font-bold bg-cyan-400 hover:bg-cyan-300 rounded-md transition-colors focus-ring"
                          >
                            {t('chat.resetConfirmAction')}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Active Model Pill */}
                    <div className="hidden sm:flex items-center gap-1 px-2 py-0.5 bg-slate-900/80 border border-slate-800 rounded-xl text-[10px] font-mono text-slate-300">
                      <Sparkles className="w-3 h-3 text-cyan-400" />
                      <span className="truncate max-w-[90px]">{settings.chatModel || settings.defaultModel || 'llama3.2'}</span>
                    </div>

                    {/* Send or Stop Generation Button */}
                    {c.isGenerating ? (
                      <button
                        type="button"
                        onClick={c.handleStopGeneration}
                        aria-label={t('chat.stop')}
                        title={t('chat.stop')}
                        className="w-7 h-7 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center transition-all shadow-md shadow-rose-950/50 active:scale-95 animate-pulse"
                      >
                        <Square className="w-3 h-3 fill-current" />
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={!c.input.trim()}
                        aria-label={t('chat.send')}
                        className="w-7 h-7 rounded-full bg-gradient-to-tr from-cyan-600 to-sky-500 hover:from-cyan-500 hover:to-sky-400 disabled:opacity-30 disabled:cursor-not-allowed text-slate-950 flex items-center justify-center transition-all shadow-md shadow-cyan-950/50 active:scale-95"
                      >
                        <ArrowUp className="w-3.5 h-3.5 font-bold" />
                      </button>
                    )}
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>

      {onUpdateSettings && (
        <SystemPromptModal
          isOpen={c.isPromptModalOpen}
          onClose={() => c.setIsPromptModalOpen(false)}
          module="chat"
          moduleTitle={t('chat.title')}
          activeModelName={settings.chatModel || settings.defaultModel || 'llama3.2'}
          settings={settings}
          onUpdateSettings={onUpdateSettings}
        />
      )}
    </div>
  )
}
