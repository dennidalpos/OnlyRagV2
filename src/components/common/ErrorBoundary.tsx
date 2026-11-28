import { Component, ErrorInfo, ReactNode } from 'react'
import { logger } from '../../lib/logger'
import { normalizeError, NormalizedError } from '../../lib/errors/errorNormalizer'
import { AlertTriangle, RefreshCw, Copy, Check } from 'lucide-react'
import { errorMessage } from '../../../shared/domain/errors/errorMessage'
import { useTranslation } from '../../i18n'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  copied: boolean
  normalized: NormalizedError | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
    normalized: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    const normalized = normalizeError(error, 'React UI')
    return { hasError: true, error, errorInfo: null, copied: false, normalized }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo })
    logger.error('ErrorBoundary', `Uncaught React Component Exception: ${error.message}\nComponent Stack:\n${errorInfo.componentStack}`)
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  private handleCopyError = async (): Promise<void> => {
    const errorDetails = [
      `Error Category: ${this.state.normalized?.category || 'UNKNOWN'}`,
      `Message: ${this.state.normalized?.message || this.state.error?.message || 'Unknown'}`,
      this.state.normalized?.remediation ? `Remediation: ${this.state.normalized.remediation}` : '',
      `Component Stack: ${this.state.errorInfo?.componentStack || 'N/A'}`,
      `User Agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A'}`,
      `Time: ${new Date().toISOString()}`,
    ]
      .filter(Boolean)
      .join('\n\n')

    try {
      await navigator.clipboard.writeText(errorDetails)
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 2000)
    } catch (err: unknown) {
      logger.warn('ErrorBoundary', `Failed to copy error to clipboard: ${errorMessage(err)}`)
    }
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <ErrorFallbackView
          normalized={this.state.normalized}
          error={this.state.error}
          copied={this.state.copied}
          onCopy={this.handleCopyError}
          onReload={this.handleReload}
        />
      )
    }

    return this.props.children
  }
}

interface ErrorFallbackViewProps {
  normalized: NormalizedError | null
  error: Error | null
  copied: boolean
  onCopy: () => void
  onReload: () => void
}

/** Crash screen; a function component so it can read the active language (Italian outside the provider). */
function ErrorFallbackView({ normalized, error, copied, onCopy, onReload }: ErrorFallbackViewProps) {
  const { t } = useTranslation()
  return (
    <div role="alert" aria-live="assertive" className="h-screen w-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 select-text">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4 text-center">
        <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mx-auto text-rose-400">
          <AlertTriangle className="w-6 h-6" />
        </div>

        <div>
          <h2 className="text-lg font-bold text-slate-100">{normalized?.title || t('errorBoundary.title')}</h2>
          <p className="text-xs text-slate-400 mt-1">{normalized?.remediation || t('errorBoundary.description')}</p>
        </div>

        {(normalized?.message || error) && (
          <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-left font-mono text-[11px] text-rose-300 overflow-x-auto max-h-32">
            {normalized?.message || error?.toString()}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onCopy}
            aria-label={t('errorBoundary.copyDetailsLabel')}
            className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-200 font-semibold text-xs rounded-xl transition-all flex items-center justify-center gap-2 border border-slate-700/80 focus-ring active:scale-95"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-emerald-400" /> {t('errorBoundary.copied')}
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 text-slate-400" /> {t('errorBoundary.copyDetails')}
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onReload}
            aria-label={t('errorBoundary.reloadLabel')}
            className="flex-1 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold text-xs rounded-xl transition-all flex items-center justify-center gap-2 shadow-md focus-ring active:scale-95"
          >
            <RefreshCw className="w-4 h-4" /> {t('errorBoundary.reload')}
          </button>
        </div>
      </div>
    </div>
  )
}
