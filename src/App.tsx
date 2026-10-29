import { AppLayout } from './components/layout/AppLayout'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { ToastProvider } from './components/common/Toast'
import { I18nProvider } from './i18n'

export function App() {
  return (
    <ErrorBoundary>
      <I18nProvider>
        <ToastProvider>
          <AppLayout />
        </ToastProvider>
      </I18nProvider>
    </ErrorBoundary>
  )
}
