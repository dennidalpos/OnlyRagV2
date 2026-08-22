import { describe, it, expect, beforeEach } from 'vitest'
import {
  processPullProgressEvent,
  getGlobalDownloadState,
  resetGlobalDownloadState,
} from './useModelDownloadProgress'

describe('useModelDownloadProgress state transitions', () => {
  beforeEach(() => {
    resetGlobalDownloadState()
  })

  it('initializes with idle download state', () => {
    const state = getGlobalDownloadState()
    expect(state.isDownloading).toBe(false)
    expect(state.percent).toBe(0)
    expect(state.modelName).toBe('')
    expect(state.lastCompletedModel).toBeNull()
  })

  it('updates state when pull progress events are received', () => {
    const updated = processPullProgressEvent({
      modelName: 'qwen2.5-coder:7b',
      status: 'downloading',
      completed: 2 * 1024 * 1024 * 1024,
      total: 4 * 1024 * 1024 * 1024,
    })

    expect(updated.isDownloading).toBe(true)
    expect(updated.modelName).toBe('qwen2.5-coder:7b')
    expect(updated.percent).toBe(50)
    expect(updated.mbCompleted).toBe('2048')
    expect(updated.mbTotal).toBe('4096')
  })

  it('marks state as completed when download reaches completion', () => {
    const updated = processPullProgressEvent({
      modelName: 'qwen2.5-coder:7b',
      status: 'success',
      completed: 4 * 1024 * 1024 * 1024,
      total: 4 * 1024 * 1024 * 1024,
    })

    expect(updated.isDownloading).toBe(false)
    expect(updated.lastCompletedModel).toBe('qwen2.5-coder:7b')
    expect(updated.percent).toBe(100)
  })

  it('resets state properly when resetGlobalDownloadState is called', () => {
    processPullProgressEvent({
      modelName: 'qwen2.5-coder:7b',
      status: 'downloading',
      completed: 1024,
      total: 2048,
    })
    expect(getGlobalDownloadState().isDownloading).toBe(true)

    resetGlobalDownloadState()
    expect(getGlobalDownloadState().isDownloading).toBe(false)
    expect(getGlobalDownloadState().percent).toBe(0)
    expect(getGlobalDownloadState().modelName).toBe('')
  })
})
