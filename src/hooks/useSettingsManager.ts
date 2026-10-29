import { useState } from 'react'
import { DiagnosticsData, AppSettings } from '../types'
import type { PromptNodeId } from '../constants/promptConfig'
import { errorMessage } from '../../shared/domain/errors/errorMessage'
import { translate } from '../i18n/I18nContext'

export function useSettingsManager(
  diagnostics: DiagnosticsData | null,
  settings: AppSettings,
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void,
  onRefreshDiagnostics: () => void,
) {
  const [pullModelInput, setPullModelInput] = useState('')
  const [isPulling, setIsPulling] = useState(false)
  const [pullMessage, setPullMessage] = useState('')
  const [activePromptNodeId, setActivePromptNodeId] = useState<PromptNodeId | null>(null)
  const [isWizardOpen, setIsWizardOpen] = useState<boolean>(false)

  const handlePullModel = async () => {
    if (!pullModelInput.trim() || !window.electronAPI) return
    setIsPulling(true)
    setPullMessage(`Pulling ${pullModelInput}...`)
    try {
      const res = await window.electronAPI.pullOllamaModel({ modelName: pullModelInput.trim(), host: settings.ollamaHost })
      if (res.success) {
        setPullMessage(`Successfully pulled ${pullModelInput}`)
        setPullModelInput('')
        onRefreshDiagnostics()
      } else {
        setPullMessage(`Failed to pull model: ${res.error || 'Unknown error'}`)
      }
    } catch (err: unknown) {
      setPullMessage(`Error: ${errorMessage(err)}`)
    } finally {
      setIsPulling(false)
    }
  }

  /** Confirmation belongs to the UI, not here: the caller asks in place (see InlineDestructiveConfirm), so this used to raise a SECOND, native prompt on top of the one the user had already answered. */
  const handleDeleteModel = async (modelName: string) => {
    if (!window.electronAPI) return
    const res = await window.electronAPI.deleteOllamaModel({ modelName, host: settings.ollamaHost })
    if (res.success) {
      setPullMessage(`Deleted ${modelName}`)
      onRefreshDiagnostics()
    } else {
      setPullMessage(`Failed to delete model: ${res.error || 'Unknown error'}`)
    }
  }

  const handleUnloadModel = async (modelName: string) => {
    if (!window.electronAPI?.unloadModel) return
    const res = await window.electronAPI.unloadModel({ modelName, host: settings.ollamaHost })
    if (res?.success) {
      setPullMessage(translate('services.modelUnloaded', { model: modelName }))
      onRefreshDiagnostics()
    } else {
      setPullMessage(translate('services.modelUnloadFailed', { model: modelName, message: res?.error || translate('agentRun.unknownError') }))
    }
  }

  return {
    pullModelInput,
    setPullModelInput,
    isPulling,
    pullMessage,
    activePromptNodeId,
    setActivePromptNodeId,
    isWizardOpen,
    setIsWizardOpen,
    handlePullModel,
    handleDeleteModel,
    handleUnloadModel,
  }
}
