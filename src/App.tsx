import React from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { ToastProvider } from './components/common/Toast'

export function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AppLayout />
      </ToastProvider>
    </ErrorBoundary>
  )
}

export default App
