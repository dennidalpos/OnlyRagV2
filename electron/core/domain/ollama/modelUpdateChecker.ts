

export interface ParsedModelTarget {
  namespace: string
  model: string
  tag: string
}

/**
 * Normalizes a SHA256 digest string by stripping optional 'sha256:' prefixes,
 * trimming whitespace, and converting to lowercase hex.
 */
export function normalizeDigest(digest?: string | null): string {
  if (!digest || typeof digest !== 'string') return ''
  const trimmed = digest.trim().toLowerCase()
  if (trimmed.startsWith('sha256:')) {
    return trimmed.slice(7).trim()
  }
  return trimmed
}

/** Parses an Ollama model name/tag into registry components (namespace, model, tag). */
export function parseModelTag(rawName: string): ParsedModelTarget {
  if (!rawName || typeof rawName !== 'string') {
    return { namespace: 'library', model: '', tag: 'latest' }
  }

  let cleaned = rawName.trim()

  // Handle potential custom registry host prefix (e.g. localhost:5000/ns/model:tag)
  const slashParts = cleaned.split('/')
  let namespace = 'library'
  let modelWithTag = cleaned

  if (slashParts.length === 2) {
    namespace = slashParts[0].trim() || 'library'
    modelWithTag = slashParts[1].trim()
  } else if (slashParts.length > 2) {
    // e.g. domain/ns/model
    namespace = slashParts[slashParts.length - 2].trim() || 'library'
    modelWithTag = slashParts[slashParts.length - 1].trim()
  }

  let model = modelWithTag
  let tag = 'latest'

  const colonIdx = modelWithTag.lastIndexOf(':')
  if (colonIdx !== -1) {
    model = modelWithTag.substring(0, colonIdx).trim()
    tag = modelWithTag.substring(colonIdx + 1).trim() || 'latest'
  }

  return {
    namespace,
    model,
    tag,
  }
}

/**
 * Evaluates whether there is a valid digest discrepancy between local and remote manifest digests.
 * Returns true if both digests are valid non-empty hex strings and they differ.
 */
export function hasDigestDiscrepancy(localDigest?: string | null, remoteDigest?: string | null): boolean {
  const normLocal = normalizeDigest(localDigest)
  const normRemote = normalizeDigest(remoteDigest)

  if (!normLocal || !normRemote) {
    return false
  }

  return normLocal !== normRemote
}
