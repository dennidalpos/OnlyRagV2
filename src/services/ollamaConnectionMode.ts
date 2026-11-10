import type { AppSettings } from '../types'

export function isRemoteOllamaMode(settings: Pick<AppSettings, 'ollamaMode' | 'ollamaHost'>): boolean {
  if (settings.ollamaMode) return settings.ollamaMode === 'remote'
  const host = (settings.ollamaHost || '').toLowerCase()
  return Boolean(host && !host.includes('127.0.0.1') && !host.includes('localhost'))
}
