import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettings } from '../types'
import { errorMessage } from '../../shared/domain/errors/errorMessage'
import { logger } from '../lib/logger'

type SaveState = { status: 'idle' | 'saving' | 'saved' | 'failed' }

/** Serial settings writes shared by debounce, retry and the Main close handshake. */
export function useSettingsPersistence(settings: AppSettings, ready: boolean, retry: number) {
  const [state, setState] = useState<SaveState>({ status: 'idle' })
  const latest = useRef({ settings, ready })
  latest.current = { settings, ready }
  const confirmed = useRef<AppSettings | null>(null)
  const chain = useRef<Promise<boolean>>(Promise.resolve(true))
  const mounted = useRef(true)

  const write = useCallback((snapshot: AppSettings): Promise<boolean> => {
    const pending = chain.current.then(async () => {
      if (!latest.current.ready || snapshot !== latest.current.settings || snapshot === confirmed.current) return true
      try {
        if ((await window.electronAPI?.saveAppSettings(snapshot)) !== true) throw new Error('Settings save failed')
        confirmed.current = snapshot
        if (mounted.current && snapshot === latest.current.settings) setState({ status: 'saved' })
        return true
      } catch (error) {
        logger.error('Settings', `Failed saving settings: ${errorMessage(error)}`)
        if (mounted.current && snapshot === latest.current.settings) setState({ status: 'failed' })
        return false
      }
    })
    chain.current = pending
    return pending
  }, [])

  const flush = useCallback(async (): Promise<boolean> => {
    // Bootstrap has accepted no changes yet; never persist defaults over an unread file.
    while (latest.current.ready) {
      const snapshot = latest.current.settings
      if (!(await write(snapshot))) return false
      if (snapshot === latest.current.settings) return confirmed.current === snapshot
    }
    return true
  }, [write])

  useEffect(() => {
    mounted.current = true
    const closeBridge = window as Window & { __onlyragFlushSettings?: () => Promise<boolean> }
    closeBridge.__onlyragFlushSettings = flush
    return () => {
      mounted.current = false
      if (closeBridge.__onlyragFlushSettings === flush) delete closeBridge.__onlyragFlushSettings
      // Navigation/unmount also submits pending values; native close awaits flush before unmount.
      void flush()
    }
  }, [flush])

  useEffect(() => {
    if (!ready) return
    setState({ status: 'saving' })
    const timer = setTimeout(() => {
      void write(settings)
    }, 100)
    return () => clearTimeout(timer)
  }, [settings, ready, retry, write])

  return state
}
