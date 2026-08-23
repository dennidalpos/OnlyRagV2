/**
 * Centralized Error Notifier for OnlyRag V2
 * Dispatches normalized errors to UI toasts with deduplication and audio/logging triggers.
 */

import { normalizeError, NormalizedError } from './errorNormalizer'
import { ToastType } from '../../components/common/Toast'

const DEDUPLICATION_TTL_MS = 3000
const deduplicationCache = new Map<string, number>()

export interface NotifyErrorOptions {
  context?: string
  duration?: number
  dedupeKey?: string
  onNormalized?: (normalized: NormalizedError) => void
}

/**
 * Dispatches a normalized error notification, preventing duplicate toasts within 3000ms window
 */
export function notifyError(
  err: unknown,
  showToastFn?: (message: string, type?: ToastType, duration?: number) => void,
  options: NotifyErrorOptions = {}
): NormalizedError {
  const normalized = normalizeError(err, options.context)

  // Construct deduplication signature
  const signature = options.dedupeKey || `${normalized.category}:${normalized.message}`
  const now = Date.now()
  const lastSeen = deduplicationCache.get(signature)

  if (lastSeen && now - lastSeen < DEDUPLICATION_TTL_MS) {
    // Duplicate detected within debounce TTL window - suppress toast
    options.onNormalized?.(normalized)
    return normalized
  }

  // Update deduplication cache and evict stale entries
  deduplicationCache.set(signature, now)
  for (const [key, timestamp] of deduplicationCache.entries()) {
    if (now - timestamp > DEDUPLICATION_TTL_MS * 2) {
      deduplicationCache.delete(key)
    }
  }

  // Format user-facing message
  let displayMessage = normalized.message
  if (normalized.remediation) {
    displayMessage = `${normalized.message}\n💡 ${normalized.remediation}`
  }

  if (showToastFn) {
    showToastFn(displayMessage, 'error', options.duration ?? 4500)
  }

  options.onNormalized?.(normalized)
  return normalized
}

/**
 * Clears the deduplication cache (used primarily in unit tests)
 */
export function clearErrorDeduplicationCache(): void {
  deduplicationCache.clear()
}
