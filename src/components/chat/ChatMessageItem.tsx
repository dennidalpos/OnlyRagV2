import React, { useEffect, useRef, useState } from 'react'
import { Bot, Check, Copy, Loader2, Sparkles, User } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage, CitationSource, SourceLocation } from '../../types'
import { useTranslation } from '../../i18n'
import { electronApi } from '../../services/electronApi'
import { sourceLocationRequest } from '../../services/chatSourceReferences'
import { Modal } from '../common/Modal'
import { errorMessage } from '../../../shared/domain/errors/errorMessage'
import { ChatContextCoveragePanel } from './ChatContextCoveragePanel'

interface ChatMessageItemProps {
  msg: ChatMessage
  isCopied: boolean
  /** Index of this message's citation that was just copied, or null. */
  copiedCitationIndex: number | null
  onCopyMessage: (msgId: string, text: string) => void
  onCopyCitation: (msgId: string, index: number, snippet: string) => void
}

function safeExternalUrl(href: string | undefined): string | null {
  if (!href) return null
  try {
    const url = new URL(href)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

function renderCitations(
  children: React.ReactNode,
  sources: CitationSource[] | undefined,
  onOpen: (source: CitationSource) => void,
  title: string,
): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      return child.split(/(\[S[1-9]\d*\])/g).map((part, index) => {
        const source = sources?.find((item) => `[${item.referenceId}]` === part && item.citationState === 'cited' && sourceLocationRequest(item))
        return source ? (
          <button key={index} type="button" onClick={() => onOpen(source)} className="text-cyan-300 underline focus-ring" title={title}>
            {part}
          </button>
        ) : (
          part
        )
      })
    }
    return child
  })
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
  const [location, setLocation] = useState<SourceLocation | null>(null)
  const [locationError, setLocationError] = useState('')
  const [isOpening, setIsOpening] = useState(false)
  const navigation = useRef(0)
  const [showLocation, setShowLocation] = useState(false)
  useEffect(
    () => () => {
      navigation.current++
    },
    [],
  )
  const openSource = async (source: CitationSource) => {
    if (msg.isStreaming || source.citationState !== 'cited') return
    const request = sourceLocationRequest(source)
    if (!request) return
    const attempt = ++navigation.current
    setShowLocation(true)
    setLocation(null)
    setLocationError('')
    setIsOpening(true)
    try {
      const result = await electronApi().getSourceLocation(request)
      if (navigation.current === attempt) setLocation(result)
    } catch (error: unknown) {
      if (navigation.current === attempt) setLocationError(errorMessage(error))
    } finally {
      if (navigation.current === attempt) setIsOpening(false)
    }
  }

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
      <div className={`space-y-2 max-w-[85%] min-w-0 ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`p-4 rounded-2xl text-sm leading-relaxed border select-text ${
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
          {msg.text || msg.interrupted ? (
            <div className="font-sans text-slate-200 break-words selection:bg-cyan-500/30 selection:text-cyan-100">
              {isUser || msg.isStreaming ? (
                <div className="whitespace-pre-wrap">{msg.text}</div>
              ) : (
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  skipHtml
                  components={{
                    p: ({ children }) => (
                      <p className="mb-2 last:mb-0 whitespace-pre-wrap">
                        {renderCitations(children, msg.sources, (source) => void openSource(source), t('chat.openOriginal'))}
                      </p>
                    ),
                    li: ({ children }) => (
                      <li className="my-0.5">{renderCitations(children, msg.sources, (source) => void openSource(source), t('chat.openOriginal'))}</li>
                    ),
                    th: ({ children }) => (
                      <th className="border border-slate-700 bg-slate-800 px-2 py-1 text-left font-semibold">
                        {renderCitations(children, msg.sources, (source) => void openSource(source), t('chat.openOriginal'))}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className="border border-slate-700 px-2 py-1 align-top">
                        {renderCitations(children, msg.sources, (source) => void openSource(source), t('chat.openOriginal'))}
                      </td>
                    ),
                    h1: ({ children }) => (
                      <h1 className="mb-2 text-lg font-semibold">
                        {renderCitations(children, msg.sources, (source) => void openSource(source), t('chat.openOriginal'))}
                      </h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="mb-2 text-base font-semibold">
                        {renderCitations(children, msg.sources, (source) => void openSource(source), t('chat.openOriginal'))}
                      </h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="mb-2 font-semibold">
                        {renderCitations(children, msg.sources, (source) => void openSource(source), t('chat.openOriginal'))}
                      </h3>
                    ),
                    strong: ({ children }) => (
                      <strong>{renderCitations(children, msg.sources, (source) => void openSource(source), t('chat.openOriginal'))}</strong>
                    ),
                    em: ({ children }) => <em>{renderCitations(children, msg.sources, (source) => void openSource(source), t('chat.openOriginal'))}</em>,
                    del: ({ children }) => <del>{renderCitations(children, msg.sources, (source) => void openSource(source), t('chat.openOriginal'))}</del>,
                    ul: ({ children }) => <ul className="mb-2 list-disc pl-5">{children}</ul>,
                    ol: ({ children }) => <ol className="mb-2 list-decimal pl-5">{children}</ol>,
                    blockquote: ({ children }) => <blockquote className="mb-2 border-l-2 border-slate-600 pl-3 text-slate-300">{children}</blockquote>,
                    table: ({ children }) => (
                      <div className="mb-2 max-w-full overflow-x-auto">
                        <table className="min-w-max border-collapse text-left text-xs">{children}</table>
                      </div>
                    ),
                    pre: ({ children }) => <pre className="mb-2 max-w-full overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs">{children}</pre>,
                    code: ({ children, className }) => <code className={`${className || ''} rounded bg-slate-950 px-1 font-mono text-xs`}>{children}</code>,
                    a: ({ children, href }) => {
                      const safeHref = safeExternalUrl(href)
                      return safeHref ? (
                        <a href={safeHref} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline focus-ring">
                          {children}
                        </a>
                      ) : (
                        <span>{children}</span>
                      )
                    },
                    img: ({ alt }) => <span>{alt || ''}</span>,
                  }}
                >
                  {msg.text}
                </Markdown>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-cyan-400 animate-pulse py-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="text-[11px] font-medium">{t('chat.generating')}</span>
            </div>
          )}

          {msg.interrupted && (
            <p role="status" className="text-amber-300">
              {t('chat.generationInterrupted')}
            </p>
          )}
          {/* Retrieved candidate passages */}
          {!isUser && msg.contextCoverage && <ChatContextCoveragePanel coverage={msg.contextCoverage} />}
          {msg.invalidSourceReferences?.length ? (
            <p role="status" className="text-amber-300">
              {t('chat.invalidSourceReferences', { references: msg.invalidSourceReferences.join(', ') })}
            </p>
          ) : null}
          {msg.sources && msg.sources.length > 0 && (
            <ChatMessageSources msg={msg} copiedCitationIndex={copiedCitationIndex} onCopyCitation={onCopyCitation} onOpenSource={openSource} />
          )}
        </div>
      </div>
      <Modal
        isOpen={showLocation}
        onClose={() => {
          navigation.current++
          setShowLocation(false)
        }}
        labelledById={`source-location-${msg.id}`}
      >
        <div className="p-4 space-y-3 overflow-auto">
          <div className="flex items-center justify-between">
            <h2 id={`source-location-${msg.id}`}>{t('chat.originalLocation')}</h2>
            <button
              type="button"
              onClick={() => {
                navigation.current++
                setShowLocation(false)
              }}
            >
              {t('common.close')}
            </button>
          </div>
          {isOpening && <p role="status">{t('chat.openingOriginal')}</p>}
          {locationError && (
            <p role="alert">
              {t('chat.originalUnavailable')} {locationError}
            </p>
          )}
          {location && (
            <>
              <p>
                {t('chat.locationVerified')} {location.page_number ? t('chat.sourcePage', { page: location.page_number }) : location.section_header}
              </p>
              <p className="text-sm text-slate-400">{t('chat.locationSupportHint')}</p>
              <pre className="whitespace-pre-wrap text-sm">{location.exact_quote}</pre>
              {location.image_base64 && (
                <img src={`data:image/png;base64,${location.image_base64}`} alt={t('chat.sourcePage', { page: location.page_number || 1 })} />
              )}
            </>
          )}
        </div>
      </Modal>
    </div>
  )
})

function ChatMessageSources({
  msg,
  copiedCitationIndex,
  onCopyCitation,
  onOpenSource,
}: Pick<ChatMessageItemProps, 'msg' | 'copiedCitationIndex' | 'onCopyCitation'> & { onOpenSource: (source: CitationSource) => Promise<void> }) {
  const { t } = useTranslation()
  const sources = msg.sources || []
  const uniqueDocNames = Array.from(new Set(sources.map((s) => s.docName || t('common.document'))))
  const headerLabel =
    uniqueDocNames.length === 1
      ? t('chat.sourcesFromDocument', { count: sources.length, document: uniqueDocNames[0] })
      : t('chat.sourcesFromDocuments', { count: sources.length, documents: uniqueDocNames.length })

  return (
    <div className="mt-3 pt-3 border-t border-slate-800/80 space-y-2">
      <div className="text-xs font-bold text-cyan-300 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-cyan-400" />
          <span>{t('chat.sourcesTitle', { label: headerLabel })}</span>
        </div>
      </div>
      <p className="text-xs text-slate-400">{t('chat.rankingScoreHint')}</p>
      <div className="grid grid-cols-1 gap-1.5">
        {sources.map((src, idx) => (
          <div key={idx} className="p-2 bg-slate-950/70 border border-slate-800/80 rounded-xl space-y-1">
            <div className="flex flex-wrap items-start justify-between gap-2 text-xs">
              <div className="flex min-w-32 flex-1 flex-wrap items-center gap-1.5">
                <span className="px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-800/60 text-cyan-300 font-mono text-xs font-bold">
                  {t('chat.excerptLabel', { index: idx + 1 })}
                </span>
                <span className="font-semibold text-slate-300 break-all">{src.docName}</span>
                {src.sectionHeader && <span className="text-slate-400 break-words">({src.sectionHeader})</span>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-cyan-400 font-mono text-xs px-1.5 py-0.5 bg-cyan-950/80 border border-cyan-800/50 rounded-full">
                  {t('chat.rankingScore')}: {src.score.toFixed(3)}
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
            <p className="text-xs text-slate-300">
              {src.citationState === 'cited' ? t('chat.modelCitedPassage') : t('chat.uncitedCandidate')} {src.referenceId ? `[${src.referenceId}]` : ''}
            </p>
            {!msg.isStreaming && src.citationState === 'cited' && sourceLocationRequest(src) ? (
              <button type="button" className="text-xs text-cyan-300 underline focus-ring" onClick={() => void onOpenSource(src)}>
                {t('chat.openOriginal')}
              </button>
            ) : (
              <p className="text-xs text-slate-400">{t('chat.originalUnavailable')}</p>
            )}
            <p className="text-xs text-slate-400 font-sans italic line-clamp-3 leading-relaxed">"{src.snippet}"</p>
          </div>
        ))}
      </div>
    </div>
  )
}
