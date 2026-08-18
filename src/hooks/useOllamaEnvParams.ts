import { useMemo, useState } from 'react'
import { DiagnosticsData } from '../types'
import { apiService } from '../services/api'
import { getRecommendedOllamaEnvVars, OllamaEnvConfig } from '../services/hardwareRecommendationEngine'
import { useTranslation } from '../i18n'

/**
 * Shared state/logic for the "Ollama Client OS Parameters" feature (recommended
 * OLLAMA_* environment variables for the detected hardware profile), so both the
 * Diagnostics Drawer and the Settings page can offer the same view/apply flow
 * without duplicating the approval-modal handler.
 */
export function useOllamaEnvParams(diagnostics: DiagnosticsData | null, onRefreshDiagnostics: () => void) {
  const { t } = useTranslation()
  const [showEnvParamsModal, setShowEnvParamsModal] = useState(false)
  const [showApprovalModal, setShowApprovalModal] = useState(false)
  const [isApplyingEnvVars, setIsApplyingEnvVars] = useState(false)
  const [restartOllamaAfterApply, setRestartOllamaAfterApply] = useState(true)
  const [applyEnvFeedback, setApplyEnvFeedback] = useState<{ success: boolean; message: string } | null>(null)

  // getRecommendedOllamaEnvVars already tolerates a null diagnostics snapshot
  // (falls back to the legacy/CPU-only tier), matching how the rest of the
  // hardware-recommendation surfaces (e.g. analyzeHardwareAndRecommend) behave
  // before the first diagnostics scan completes.
  const envConfig: OllamaEnvConfig = useMemo(() => getRecommendedOllamaEnvVars(diagnostics, t), [diagnostics, t])

  const handleApplyEnvVars = async () => {
    if (!envConfig || envConfig.variables.length === 0) return
    setIsApplyingEnvVars(true)
    try {
      const res = await apiService.applyOllamaEnvironmentVariables(
        envConfig.variables.map((v) => ({ name: v.name, value: v.value })),
        restartOllamaAfterApply
      )
      setApplyEnvFeedback({
        success: res.success,
        message: res.message || (res.success ? 'OK' : 'Error'),
      })
      setShowApprovalModal(false)
      onRefreshDiagnostics()
    } catch (err: any) {
      setApplyEnvFeedback({ success: false, message: err.message })
    } finally {
      setIsApplyingEnvVars(false)
    }
  }

  return {
    envConfig,
    showEnvParamsModal,
    setShowEnvParamsModal,
    showApprovalModal,
    setShowApprovalModal,
    isApplyingEnvVars,
    restartOllamaAfterApply,
    setRestartOllamaAfterApply,
    applyEnvFeedback,
    handleApplyEnvVars,
  }
}
