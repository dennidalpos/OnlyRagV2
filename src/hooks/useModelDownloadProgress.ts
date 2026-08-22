import { useState, useEffect, useCallback } from 'react'

export interface ModelDownloadState {
  isDownloading: boolean
  modelName: string
  percent: number
  mbCompleted: string
  mbTotal: string
  status: string
  lastCompletedModel: string | null
  error: string | null
}

let globalDownloadState: ModelDownloadState = {
  isDownloading: false,
  modelName: '',
  percent: 0,
  mbCompleted: '0',
  mbTotal: '0',
  status: '',
  lastCompletedModel: null,
  error: null,
}

const listeners = new Set<(state: ModelDownloadState) => void>()

function broadcast(state: ModelDownloadState) {
  globalDownloadState = state
  for (const listener of listeners) {
    listener(state)
  }
}

export function getGlobalDownloadState(): ModelDownloadState {
  return globalDownloadState
}

export function processPullProgressEvent(data: any): ModelDownloadState {
  if (!data || !data.modelName) return globalDownloadState

  const total = data.total || 0
  const completed = data.completed || 0
  const isDone = (total > 0 && completed >= total) || data.status === 'success'

  if (isDone) {
    const newState: ModelDownloadState = {
      isDownloading: false,
      modelName: data.modelName,
      percent: 100,
      mbCompleted: total > 0 ? (total / (1024 * 1024)).toFixed(0) : '0',
      mbTotal: total > 0 ? (total / (1024 * 1024)).toFixed(0) : '0',
      status: 'Completato con successo',
      lastCompletedModel: data.modelName,
      error: null,
    }
    broadcast(newState)
    return newState
  } else if (total > 0 && completed > 0) {
    const pct = Math.min(99, Math.round((completed / total) * 100))
    const mbComp = (completed / (1024 * 1024)).toFixed(0)
    const mbTot = (total / (1024 * 1024)).toFixed(0)

    const newState: ModelDownloadState = {
      isDownloading: true,
      modelName: data.modelName,
      percent: pct,
      mbCompleted: mbComp,
      mbTotal: mbTot,
      status: data.status || 'downloading',
      lastCompletedModel: null,
      error: null,
    }
    broadcast(newState)
    return newState
  } else if (data.status) {
    const newState: ModelDownloadState = {
      ...globalDownloadState,
      isDownloading: true,
      modelName: data.modelName,
      status: data.status,
      error: null,
    }
    broadcast(newState)
    return newState
  }
  return globalDownloadState
}

export function resetGlobalDownloadState() {
  broadcast({
    isDownloading: false,
    modelName: '',
    percent: 0,
    mbCompleted: '0',
    mbTotal: '0',
    status: '',
    lastCompletedModel: null,
    error: null,
  })
}

let isGlobalListenerAttached = false

function ensureGlobalListener() {
  if (isGlobalListenerAttached) return
  if (typeof window === 'undefined' || !window.electronAPI?.onOllamaPullProgress) return

  isGlobalListenerAttached = true
  window.electronAPI.onOllamaPullProgress((data: any) => {
    processPullProgressEvent(data)
  })
}

export function useModelDownloadProgress() {
  const [state, setState] = useState<ModelDownloadState>(globalDownloadState)

  useEffect(() => {
    ensureGlobalListener()
    listeners.add(setState)
    return () => {
      listeners.delete(setState)
    }
  }, [])

  const cancelDownload = useCallback(async () => {
    if (window.electronAPI?.cancelPullOllamaModel) {
      try {
        await window.electronAPI.cancelPullOllamaModel()
      } catch {}
    }
    resetGlobalDownloadState()
  }, [])

  return {
    ...state,
    resetDownloadState: resetGlobalDownloadState,
    cancelDownload,
  }
}
