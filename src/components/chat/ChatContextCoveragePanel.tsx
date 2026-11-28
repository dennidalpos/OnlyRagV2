import { Tooltip } from '../common/Tooltip'
import type { ChatContextCoverage } from '../../../shared/domain/chatContextCoverage'
import { useTranslation } from '../../i18n'

export function ChatContextCoveragePanel({ coverage }: { coverage: ChatContextCoverage }) {
  const { t } = useTranslation()
  return (
    <details className="mt-3 rounded-lg border border-slate-700 p-3 text-xs text-slate-300">
      <summary className="cursor-pointer focus-ring">{t('chat.coverageTitle')}</summary>
      <Tooltip helpKey="chat_coverageHint" />
      <p>{t(coverage.retrieval === 'completed' ? 'chat.coverageRetrieved' : 'chat.coverageSkipped')}</p>
      <ul className="mt-2 space-y-2">
        {coverage.items.map((item, index) => (
          <li key={index} className="break-words">
            <span className="font-semibold">{item.docName}</span>
            {' · '}
            {t(item.kind === 'preview' ? 'chat.coveragePreview' : 'chat.coveragePassage')}
            {item.referenceId ? ` [${item.referenceId}]` : ''}
            {' · '}
            {t(item.status === 'included' ? 'chat.coverageIncluded' : item.status === 'truncated' ? 'chat.coverageTruncated' : 'chat.coverageExcluded')}
            {' · '}
            {t('chat.coverageChars', { included: item.text.length, total: item.originalChars })}
            {item.reason && (
              <> · {t(item.reason === 'scope' ? 'chat.coverageScope' : item.reason === 'empty' ? 'chat.coverageEmpty' : 'chat.coverageBudget')}</>
            )}
            {item.text && (
              <details className="mt-1">
                <summary className="cursor-pointer focus-ring">{t('chat.coverageText')}</summary>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-2 font-sans">{item.text}</pre>
              </details>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}
