import { useMemo } from 'react'
import { evaluateTaskComplexity, ComplexityRouteResult } from '../services/complexityRouterService'
import { AppSettings } from '../types'

export function useComplexityRouter(
  taskPrompt: string,
  pinnedFilesCount: number = 0,
  activeFileLength: number = 0,
  settings?: AppSettings,
  availableModels?: string[]
): ComplexityRouteResult {
  return useMemo(() => {
    return evaluateTaskComplexity(taskPrompt, {
      attachedFilesCount: pinnedFilesCount,
      contextSizeChars: activeFileLength,
      settings,
      availableModels,
    })
  }, [taskPrompt, pinnedFilesCount, activeFileLength, settings, availableModels?.join(',')])
}
