import type { IngestedDocument, IngestedDocumentContent } from '../types'
import { electronApi } from './electronApi'
import { logger } from '../lib/logger'
import { errorMessage } from '../../shared/domain/errors/errorMessage'

/**
 * On-demand Markdown of ingested documents. `ingest:list` carries metadata only, so every consumer
 * that needs a document's text (editor, translator, chat context, agent attachments) loads it here.
 * Entries are keyed by id and `ingestedAt`, which the sidecar refreshes on every edit, so a saved
 * document is never served from a stale entry. The cache is bounded by entries and characters.
 */
const MAX_CACHED_DOCUMENTS = 8
const MAX_CACHED_CHARS = 8_000_000

const cache = new Map<string, string>()
const inFlight = new Map<string, Promise<string | null>>()

type DocumentKey = Pick<IngestedDocument, 'id' | 'ingestedAt'>

function keyOf(doc: DocumentKey): string {
  return `${doc.id}@${doc.ingestedAt}`
}

function remember(key: string, markdown: string): void {
  cache.delete(key)
  cache.set(key, markdown)
  let totalChars = 0
  for (const value of cache.values()) totalChars += value.length
  for (const [oldestKey, value] of cache) {
    if (cache.size <= 1 || (cache.size <= MAX_CACHED_DOCUMENTS && totalChars <= MAX_CACHED_CHARS)) break
    cache.delete(oldestKey)
    totalChars -= value.length
  }
}

/** Markdown already in memory for this document version, without a request. */
export function peekDocumentMarkdown(doc: DocumentKey): string | undefined {
  return cache.get(keyOf(doc))
}

/** Stores the Markdown a mutation (ingestion, save, translation) already returned. */
export function primeDocumentMarkdown(doc: IngestedDocumentContent): void {
  remember(keyOf(doc), doc.extractedMarkdown || '')
}

/** Loads a document's Markdown; null when the document is gone or the sidecar is unreachable. */
export function loadDocumentMarkdown(doc: DocumentKey): Promise<string | null> {
  const key = keyOf(doc)
  const cached = cache.get(key)
  if (cached !== undefined) return Promise.resolve(cached)
  const pending = inFlight.get(key)
  if (pending) return pending

  const request = Promise.resolve()
    .then(() => electronApi().getIngestedDocument(doc.id))
    .then((loaded) => {
      if (!loaded) return null
      const markdown = loaded.extractedMarkdown || ''
      remember(key, markdown)
      return markdown
    })
    .catch((err: unknown) => {
      logger.error('DocumentMarkdown', `Failed to load document ${doc.id}: ${errorMessage(err)}`)
      return null
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, request)
  return request
}

export function clearDocumentMarkdownCache(): void {
  cache.clear()
  inFlight.clear()
}
