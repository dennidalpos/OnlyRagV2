import { useState, useEffect, useCallback, useRef } from 'react'
import type { OllamaModelUpdateInfo } from '../types'
import { getGlobalDownloadState, useModelDownloadProgress } from './useModelDownloadProgress'
import { logger } from '../lib/logger'
import { errorMessage } from '../../shared/domain/errors/errorMessage'
import { translate } from '../i18n/I18nContext'

interface ModelUpdatesState {
  updateAvailableMap: Record<string, boolean>
  updateInfoMap: Record<string, OllamaModelUpdateInfo>
  isCheckingUpdates: boolean
  lastCheckedAt: number | null
  error: string | null
}

let globalUpdatesState: ModelUpdatesState = {
  updateAvailableMap: {},
  updateInfoMap: {},
  isCheckingUpdates: false,
  lastCheckedAt: null,
  error: null,
}

const updateListeners = new Set<(state: ModelUpdatesState) => void>()

function broadcastUpdates(state: ModelUpdatesState) {
  globalUpdatesState = state
  for (const listener of updateListeners) {
    listener(state)
  }
}

export function clearModelUpdateAvailable(modelName: string) {
  if (!modelName) return
  const nextAvailable = { ...globalUpdatesState.updateAvailableMap }
  delete nextAvailable[modelName]
  const nextInfo = { ...globalUpdatesState.updateInfoMap }
  delete nextInfo[modelName]

  broadcastUpdates({
    ...globalUpdatesState,
    updateAvailableMap: nextAvailable,
    updateInfoMap: nextInfo,
  })
}

export function useOllamaModelUpdates(ollamaHost?: string, onRefreshDiagnostics?: () => void) {
  const [state, setState] = useState<ModelUpdatesState>(globalUpdatesState)
  const downloadProgress = useModelDownloadProgress()
  const isCheckingRef = useRef(false)

  useEffect(() => {
    updateListeners.add(setState)
    return () => {
      updateListeners.delete(setState)
    }
  }, [])

  // When a model finishes downloading successfully, clear its update_available badge and refresh diagnostics
  useEffect(() => {
    if (downloadProgress.lastCompletedModel) {
      clearModelUpdateAvailable(downloadProgress.lastCompletedModel)
      if (onRefreshDiagnostics) {
        onRefreshDiagnostics()
      }
    }
  }, [downloadProgress.lastCompletedModel, onRefreshDiagnostics])

  const checkForUpdates = useCallback(
    async (customHost?: string) => {
      if (!window.electronAPI?.checkOllamaModelUpdates) return
      if (isCheckingRef.current) return

      isCheckingRef.current = true
      broadcastUpdates({
        ...globalUpdatesState,
        isCheckingUpdates: true,
        error: null,
      })

      try {
        logger.info('useOllamaModelUpdates', 'Checking model updates on user request...')
        const results = await window.electronAPI.checkOllamaModelUpdates({ host: customHost || ollamaHost })

        const availableMap: Record<string, boolean> = {}
        const infoMap: Record<string, OllamaModelUpdateInfo> = {}

        if (results && typeof results === 'object') {
          for (const [name, info] of Object.entries(results)) {
            infoMap[name] = info
            if (info.updateAvailable) {
              availableMap[name] = true
            }
          }
        }

        broadcastUpdates({
          updateAvailableMap: availableMap,
          updateInfoMap: infoMap,
          isCheckingUpdates: false,
          lastCheckedAt: Date.now(),
          error: null,
        })
      } catch (err: unknown) {
        logger.warn('useOllamaModelUpdates', `Failed checking model updates: ${errorMessage(err)}`)
        broadcastUpdates({
          ...globalUpdatesState,
          isCheckingUpdates: false,
          error: errorMessage(err) || 'Update check failed',
        })
      } finally {
        isCheckingRef.current = false
      }
    },
    [ollamaHost],
  )

  const triggerUpdateModel = useCallback(
    async (modelName: string): Promise<{ success: boolean; error?: string }> => {
      if (!modelName || typeof modelName !== 'string') {
        return { success: false, error: 'Invalid model name' }
      }

      const currentDownload = getGlobalDownloadState()
      if (currentDownload.isDownloading && currentDownload.modelName && currentDownload.modelName !== modelName) {
        return {
          success: false,
          error: translate('services.otherModelUpdating', { model: currentDownload.modelName }),
        }
      }

      if (!window.electronAPI?.pullOllamaModel) {
        return { success: false, error: 'Ollama pull API unavailable' }
      }

      try {
        logger.info('useOllamaModelUpdates', `Starting controlled update for model: ${modelName}`)
        const res = await window.electronAPI.pullOllamaModel({ modelName, host: ollamaHost })
        if (res.success) {
          clearModelUpdateAvailable(modelName)
          if (onRefreshDiagnostics) {
            onRefreshDiagnostics()
          }
          return { success: true }
        } else {
          return { success: false, error: res.error || 'Update failed' }
        }
      } catch (err: unknown) {
        return { success: false, error: errorMessage(err) || 'Error updating model' }
      }
    },
    [ollamaHost, onRefreshDiagnostics],
  )

  const isModelUpdating = useCallback(
    (modelName?: string): boolean => {
      if (!modelName) return false
      return downloadProgress.isDownloading && downloadProgress.modelName === modelName
    },
    [downloadProgress.isDownloading, downloadProgress.modelName],
  )

  const isAnyModelUpdating = downloadProgress.isDownloading
  const currentlyUpdatingModel = downloadProgress.isDownloading ? downloadProgress.modelName : null

  return {
    updateAvailableMap: state.updateAvailableMap,
    updateInfoMap: state.updateInfoMap,
    isCheckingUpdates: state.isCheckingUpdates,
    lastCheckedAt: state.lastCheckedAt,
    checkForUpdates,
    triggerUpdateModel,
    isModelUpdating,
    isAnyModelUpdating,
    currentlyUpdatingModel,
    downloadProgress,
  }
}
