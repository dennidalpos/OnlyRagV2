import React from 'react'
import { Bot, Check, Copy, Loader2, Sparkles, User } from 'lucide-react'
import type { ChatMessage } from '../../types'
import { useTranslation } from '../../i18n'

interface ChatMessageItemProps {
  msg: ChatMessage
  isCopied: boolean
  /** Index of this message's citation that was just copied, or null. */
  copiedCitationIndex: number | null
  onCopyMessage: (msgId: string, text: string) => void
  onCopyCitation: (msgId: string, index: number, snippet: string) => void
}

/**
 * One chat message. Memoized: streaming replaces only the growing message object every 40 ms,
 * so every other message keeps its identity and skips re-rendering.
 */
export const ChatMessageItem = React.memo(function ChatMessageItem({
  msg,
  isCopied,
  copiedCitationIndex,
  onCopyMessage,
  onCopyCitation,
}: ChatMessageItemProps) {
  const { t } = useTranslation()
  const isUser = msg.sender === 'user'

  return (
    <div className={`flex gap-3 max-w-4xl ${isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}>
      {/* Avatar Icon */}
      <div
        className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
          isUser ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300' : 'bg-slate-900 border-slate-800 text-slate-400'
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
              {isUser ? t('chat.userLabel') : t('chat.assistantLabel')} • {msg.timestamp}
            </span>
            <button
              type="button"
              onClick={() => onCopyMessage(msg.id, msg.text)}
              className="p-1 hover:text-slate-200 rounded transition-colors focus-ring cursor-pointer"
              title={t('chat.copyMsg')}
              aria-label={t('chat.copyMsg')}
            >
              {isCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>

          {/* Message Text / Streaming State */}
          {msg.text ? (
            <div className="whitespace-pre-wrap font-sans text-slate-200 selection:bg-cyan-500/30 selection:text-cyan-100">{msg.text}</div>
          ) : (
            <div className="flex items-center gap-2 text-cyan-400 animate-pulse py-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="text-[11px] font-medium">{t('chat.generating')}</span>
            </div>
          )}

          {/* Citations and Source Verification Cards */}
          {msg.sources && msg.sources.length > 0 && <ChatMessageSources msg={msg} copiedCitationIndex={copiedCitationIndex} onCopyCitation={onCopyCitation} />}
        </div>
      </div>
    </div>
  )
})

function ChatMessageSources({ msg, copiedCitationIndex, onCopyCitation }: Pick<ChatMessageItemProps, 'msg' | 'copiedCitationIndex' | 'onCopyCitation'>) {
  const { t } = useTranslation()
  const sources = msg.sources || []
  const uniqueDocNames = Array.from(new Set(sources.map((s) => s.docName || t('common.document'))))
  const headerLabel =
    uniqueDocNames.length === 1
      ? t('chat.sourcesFromDocument', { count: sources.length, document: uniqueDocNames[0] })
      : t('chat.sourcesFromDocuments', { count: sources.length, documents: uniqueDocNames.length })

  return (
    <div className="mt-3 pt-3 border-t border-slate-800/80 space-y-2">
      <div className="text-[11px] font-bold text-cyan-300 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-cyan-400" />
          <span>{t('chat.sourcesTitle', { label: headerLabel })}</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        {sources.map((src, idx) => (
          <div key={idx} className="p-2 bg-slate-950/70 border border-slate-800/80 rounded-xl space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <div className="flex items-center gap-1.5 truncate max-w-[280px]">
                <span className="px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-800/60 text-cyan-300 font-mono text-[9px] font-bold">
                  {t('chat.excerptLabel', { index: idx + 1 })}
                </span>
                <span className="font-semibold text-slate-300 truncate">{src.docName}</span>
                {src.sectionHeader && <span className="text-slate-400 text-[9px] truncate">({src.sectionHeader})</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-cyan-400 font-mono text-[9px] px-1.5 py-0.2 bg-cyan-950/80 border border-cyan-800/50 rounded-full">
                  {t('chat.relevance')}: {(src.score * 100).toFixed(0)}%
                </span>
                <button
                  type="button"
                  onClick={() => onCopyCitation(msg.id, idx, src.snippet)}
                  className="p-0.5 text-slate-400 hover:text-slate-200 transition-colors focus-ring rounded cursor-pointer"
                  title={t('chat.copyCitation')}
                  aria-label={t('chat.copyCitation')}
                >
                  {copiedCitationIndex === idx ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                </button>
              </div>
            </div>
            <p className="text-[10px] text-slate-400 font-sans italic line-clamp-2 leading-relaxed">"{src.snippet}"</p>
          </div>
        ))}
      </div>
    </div>
  )
}
