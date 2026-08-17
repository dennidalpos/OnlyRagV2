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
} from 'lucide-react'
import { AppSettings, DiagnosticsData } from '../../types'
import { SystemPromptModal } from '../common/SystemPromptModal'
import { ModelBadge } from '../common/ModelBadge'
import { useChatEngine } from '../../hooks/useChatEngine'
import { useToast } from '../common/Toast'
import { useTranslation } from '../../i18n'

interface ChatViewProps {
  settings: AppSettings
  diagnostics: DiagnosticsData | null
  onUpdateSettings?: (newSettings: Partial<AppSettings>) => void
}

export const ChatView: React.FC<ChatViewProps> = ({ settings, diagnostics, onUpdateSettings }) => {
  const { t } = useTranslation()
  const c = useChatEngine(settings, diagnostics)
  const toast = useToast()
  const toolsMenuRef = useRef<HTMLDivElement>(null)
  const resetConfirmRef = useRef<HTMLDivElement>(null)
  const [showToolsMenu, setShowToolsMenu] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [copiedCitationIdx, setCopiedCitationIdx] = useState<string | null>(null)

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
            aria-label={c.autoScroll ? 'Autoscroll attivo' : 'Autoscroll disattivato'}
            title={c.autoScroll ? 'Autoscroll attivo (clicca per disattivare)' : 'Autoscroll disattivato (clicca per attivare)'}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all focus-ring active:scale-95 ${
              c.autoScroll
                ? 'bg-cyan-950/90 text-cyan-300 border border-cyan-500/60 shadow-sm'
                : 'bg-slate-900 border border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            <ArrowDown className={`w-3.5 h-3.5 ${c.autoScroll ? 'text-cyan-400' : 'text-slate-400'}`} />
            <span className="text-[11px] hidden sm:inline font-medium">Autoscroll</span>
          </button>

          {/* Active Chat Model Badge */}
          <ModelBadge
            modelName={settings.chatModel || settings.defaultModel || 'llama3.2'}
            tooltip={`Chat Model: ${settings.chatModel || settings.defaultModel || 'llama3.2'}`}
          />
        </div>
      </div>

      {/* Main Split Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar: Context Documents */}
        <div className="w-72 border-r border-slate-800 bg-slate-900/40 p-4 space-y-3 flex flex-col shrink-0">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
              <span>{t('chat.contextTitle', { selected: c.selectedDocIds.size, total: c.documents.length })}</span>
            </div>
            <button
              type="button"
              onClick={c.fetchDocuments}
              aria-label={t('chat.refreshList')}
              title={t('chat.refreshList')}
              className="p-1.5 text-slate-400 hover:text-cyan-400 transition-colors rounded-lg focus-ring active:scale-95"
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
        </div>

        {/* Right: Messages & Input */}
        <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden min-w-0">
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
                const isPendingBot = !isUser && !msg.text && c.isGenerating

                return (
                  <div key={msg.id} className={`flex gap-3 max-w-3xl ${isUser ? 'ml-auto flex-row-reverse' : ''}`}>
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
                        isUser
                          ? 'bg-indigo-950/80 text-indigo-300 border-indigo-700/80 shadow-md'
                          : 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80 shadow-md'
                      }`}
                    >
                      {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                    </div>

                    <div className={`space-y-2 group min-w-0 max-w-[85%] ${isUser ? 'items-end' : ''}`}>
                      <div
                        className={`p-4 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap break-words overflow-hidden space-y-2 ${
                          isUser
                            ? 'bg-gradient-to-r from-indigo-950/70 via-blue-950/50 to-slate-900/90 border border-indigo-500/50 text-slate-100 font-medium rounded-tr-none shadow-lg'
                            : 'bg-[#0e1422] border border-slate-800 text-slate-200 rounded-tl-none shadow-md'
                        }`}
                      >
                        <div className={`flex items-center justify-between border-b pb-1.5 text-[10px] font-mono ${isUser ? 'border-indigo-500/30 text-indigo-300' : 'border-slate-800 text-slate-400'}`}>
                          <span className="font-bold">{isUser ? t('coding.userRole') : t('coding.agentRole')}</span>
                          <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        {isPendingBot ? (
                          <div className="flex items-center gap-2 text-cyan-300 py-0.5">
                            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                            <span className="font-mono text-[11px] animate-pulse">{t('chat.generating')}</span>
                          </div>
                        ) : (
                          <div>{msg.text}</div>
                        )}
                      </div>

                      {msg.sources && msg.sources.length > 0 && (
                        <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 space-y-2 text-[11px] font-mono">
                          <div className="text-cyan-400 font-bold flex items-center gap-1.5">
                            <Sparkles className="w-3 h-3" /> {t('chat.citationsTitle', { count: msg.sources.length })}
                          </div>
                          {msg.sources.map((cite, idx) => {
                            const relevancePercent = cite.score ? Math.round(Math.min(1, Math.max(0, cite.score)) * 100) : null
                            const citationKey = `${msg.id}-${idx}`
                            return (
                              <div key={idx} className="p-2.5 bg-slate-950 rounded-lg border border-slate-800/80 text-slate-300 break-words space-y-1 group/cite">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-cyan-300 font-semibold truncate">{cite.docName}</span>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {relevancePercent !== null && (
                                      <span className="px-1.5 py-0.5 rounded bg-cyan-950/90 text-cyan-300 border border-cyan-800/80 text-[10px] font-bold font-mono">
                                        {t('chat.relevance')}: {relevancePercent}%
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        await navigator.clipboard.writeText(cite.snippet)
                                        setCopiedCitationIdx(citationKey)
                                        toast.success(t('chat.citationCopied'))
                                        setTimeout(() => setCopiedCitationIdx(null), 2000)
                                      }}
                                      aria-label={t('chat.copyCitation')}
                                      title={t('chat.copyCitation')}
                                      className="p-1 text-slate-400 hover:text-cyan-300 hover:bg-slate-800 rounded transition-colors focus-ring"
                                    >
                                      {copiedCitationIdx === citationKey ? (
                                        <Check className="w-3 h-3 text-emerald-400" />
                                      ) : (
                                        <Copy className="w-3 h-3" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                                <p className="text-slate-300 text-[11px] italic font-sans leading-relaxed">{cite.snippet}</p>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      <div className={`flex items-center gap-2 text-[10px] text-slate-400 ${isUser ? 'justify-end' : ''}`}>
                        <span>{msg.timestamp}</span>
                        {msg.text && (
                          <button
                            type="button"
                            onClick={() => {
                              c.handleCopyMessage(msg.id, msg.text)
                              toast.success(t('chat.msgCopied'))
                            }}
                            aria-label={t('chat.copyMsg')}
                            title={t('chat.copyMsg')}
                            className="opacity-70 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 hover:text-slate-200 transition-opacity focus-ring rounded p-0.5"
                          >
                            {c.copiedMsgId === msg.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}

            <div className="sr-only" aria-live="polite" aria-atomic="true">
              {c.isGenerating ? t('chat.generating') : ''}
            </div>
            <div ref={c.chatBottomRef} />
          </div>

          {/* Unified Floating Prompt Composer Bar */}
          <div className="p-4 border-t border-slate-800 bg-slate-900/60 shrink-0">
            <div className="bg-[#161c28] border border-slate-800/80 focus-within:border-cyan-500/80 focus-within:ring-1 focus-within:ring-cyan-500/30 rounded-2xl p-2.5 transition-all shadow-xl space-y-2 relative">
              {/* Center: Prompt Textarea */}
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  c.handleSendMessage(e)
                }}
                className="w-full flex flex-col space-y-2"
              >
                <textarea
                  value={c.input}
                  onChange={(e) => c.setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (c.input.trim() && !c.isGenerating) {
                        c.handleSendMessage()
                      }
                    }
                  }}
                  rows={2}
                  disabled={c.isGenerating}
                  placeholder={t('chat.inputPlaceholder')}
                  aria-label={t('chat.headerTitle')}
                  className="w-full bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-400 resize-none font-sans leading-relaxed px-1"
                />

                {/* Bottom row: [Left: Tools Popover] --- [Right: Quick Actions & Send] */}
                <div className="flex items-center justify-between pt-1 border-t border-slate-800/40">
                  {/* Left: Tools & Context Menu Trigger */}
                  <div className="relative">
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

                        {/* RAG Context Documents */}
                        <div className="space-y-1.5">
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                            <span>{t('chat.contextTitle', { selected: c.selectedDocIds.size, total: c.documents.length })}</span>
                            <button
                              type="button"
                              onClick={c.fetchDocuments}
                              title={t('chat.refreshList')}
                              className="text-[9px] text-cyan-400 hover:underline focus-ring rounded"
                            >
                              {t('common.refresh')}
                            </button>
                          </div>
                          <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                            {c.documents.length === 0 ? (
                              <div className="text-[11px] text-slate-400 italic p-1">{t('chat.noDocsIndexed')}</div>
                            ) : (
                              c.documents.map((doc) => {
                                const isSelected = c.selectedDocIds.has(doc.id)
                                return (
                                  <button
                                    key={doc.id}
                                    type="button"
                                    onClick={() => c.toggleDocSelection(doc.id)}
                                    className={`w-full text-left p-1.5 rounded-lg text-xs flex items-center justify-between transition-colors focus-ring ${
                                      isSelected ? 'bg-cyan-950 text-cyan-200 border border-cyan-800/60' : 'hover:bg-slate-800 text-slate-300'
                                    }`}
                                  >
                                    <div className="flex items-center gap-1.5 truncate">
                                      <FileText className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                                      <span className="truncate text-[11px]">{doc.filename}</span>
                                    </div>
                                    <span className="text-[9px] font-mono shrink-0">{isSelected ? '✓' : '+'}</span>
                                  </button>
                                )
                              })
                            )}
                          </div>
                        </div>

                        {/* System Prompt Trigger */}
                        <div className="pt-2 border-t border-slate-800/80">
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
          moduleTitle="RAG Chat"
          activeModelName={settings.chatModel || settings.defaultModel || 'llama3.2'}
          settings={settings}
          onUpdateSettings={onUpdateSettings}
        />
      )}
    </div>
  )
}
