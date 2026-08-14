import { useState } from 'react'
import { DiagnosticsData, AppSettings } from '../types'
import { FeatureModule } from '../constants/promptPresets'

export function useSettingsManager(
  diagnostics: DiagnosticsData | null,
  settings: AppSettings,
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void,
  onRefreshDiagnostics: () => void
) {
  const [pullModelInput, setPullModelInput] = useState('')
  const [isPulling, setIsPulling] = useState(false)
  const [pullMessage, setPullMessage] = useState('')
  const [activePromptModalModule, setActivePromptModalModule] = useState<FeatureModule | null>(null)
  const [isWizardOpen, setIsWizardOpen] = useState<boolean>(false)

  const handlePullModel = async () => {
    if (!pullModelInput.trim() || !window.electronAPI) return
    setIsPulling(true)
    setPullMessage(`Pulling ${pullModelInput}...`)
    try {
      const res = await window.electronAPI.pullOllamaModel(pullModelInput.trim())
      if (res.success) {
        setPullMessage(`Successfully pulled ${pullModelInput}`)
        setPullModelInput('')
        onRefreshDiagnostics()
      } else {
        setPullMessage(`Failed to pull model: ${res.error || 'Unknown error'}`)
      }
    } catch (err: any) {
      setPullMessage(`Error: ${err.message}`)
    } finally {
      setIsPulling(false)
    }
  }

  const handleDeleteModel = async (modelName: string) => {
    if (!window.electronAPI) return
    if (confirm(`Are you sure you want to delete model "${modelName}"?`)) {
      const res = await window.electronAPI.deleteOllamaModel(modelName)
      if (res.success) {
        onRefreshDiagnostics()
      } else {
        alert(`Failed to delete model: ${res.error}`)
      }
    }
  }

  return {
    pullModelInput,
    setPullModelInput,
    isPulling,
    pullMessage,
    activePromptModalModule,
    setActivePromptModalModule,
    isWizardOpen,
    setIsWizardOpen,
    handlePullModel,
    handleDeleteModel,
  }
}
