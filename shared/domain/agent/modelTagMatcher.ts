/**
 * Canonical Model Tag Matcher for Local Ollama Installations.
 * Single source of truth for matching model names, tags, quantization variants,
 * and namespace prefixes across Complexity Routing, Recommendations, and UI indicators.
 */

export interface ModelTagComponents {
  raw: string
  normalized: string
  namespace: string
  baseName: string
  tag: string
}

export function parseModelTagComponents(tagOrName: string): ModelTagComponents {
  if (!tagOrName || typeof tagOrName !== 'string') {
    return { raw: '', normalized: '', namespace: '', baseName: '', tag: '' }
  }

  const raw = tagOrName.trim()
  const normalized = raw.toLowerCase()

  let namespace = ''
  let remainder = normalized

  if (normalized.includes('/')) {
    const slashIdx = normalized.indexOf('/')
    namespace = normalized.slice(0, slashIdx)
    remainder = normalized.slice(slashIdx + 1)
  }

  let baseName = remainder
  let tag = ''

  if (remainder.includes(':')) {
    const colonIdx = remainder.indexOf(':')
    baseName = remainder.slice(0, colonIdx)
    tag = remainder.slice(colonIdx + 1)
  }

  return { raw, normalized, namespace, baseName, tag }
}

/**
 * Checks if two tags are compatible, respecting parameter size boundaries (e.g. 7b vs 1.5b).
 */
export function isTagCompatible(targetTag: string, installedTag: string): boolean {
  if (!targetTag || targetTag === 'latest') return true
  if (!installedTag || installedTag === 'latest') return true
  if (targetTag === installedTag) return true

  // Extract parameter size (e.g. 1.5b, 3b, 7b, 8b, 14b, 32b, 70b, 300m)
  const targetSizeMatch = targetTag.match(/^(\d+(?:\.\d+)?(?:b|m))\b/i)
  const installedSizeMatch = installedTag.match(/^(\d+(?:\.\d+)?(?:b|m))\b/i)

  if (targetSizeMatch && installedSizeMatch) {
    if (targetSizeMatch[1].toLowerCase() !== installedSizeMatch[1].toLowerCase()) {
      return false
    }
  }

  return (
    installedTag.startsWith(targetTag) ||
    targetTag.startsWith(installedTag) ||
    installedTag.includes(targetTag) ||
    targetTag.includes(installedTag)
  )
}

/**
 * Finds the exact or best-matching installed model from the list of available Ollama models.
 * Prioritizes:
 * 1. Exact match (case-insensitive)
 * 2. :latest tag equivalence
 * 3. Namespace-stripped match (e.g. adrienbrault/biomistral-7b:q4_k_m -> biomistral-7b:q4_k_m)
 * 4. Exact base model with compatible quantization/tag match
 * 5. Prefix/longest base match (preventing substring shadowing where 'qwen' shadowed 'qwen2.5-coder')
 */
export function findMatchingInstalledModel(target: string, available: string[]): string | null {
  if (!target || !available || available.length === 0) return null

  const targetParsed = parseModelTagComponents(target)
  if (!targetParsed.normalized) return null

  const { normalized: clean, baseName: cleanBase, tag: cleanTag } = targetParsed
  const cleanWithoutNamespace = targetParsed.namespace ? `${targetParsed.baseName}${targetParsed.tag ? `:${targetParsed.tag}` : ''}` : clean

  // 1. Exact case-insensitive match
  for (const m of available) {
    if (m.toLowerCase().trim() === clean) return m
  }

  // 2. :latest tag equivalence
  for (const m of available) {
    const mClean = m.toLowerCase().trim()
    if (mClean === `${clean}:latest` || `${mClean}:latest` === clean) return m
    const mParsed = parseModelTagComponents(m)
    if (!cleanTag && mParsed.baseName === cleanBase && mParsed.tag === 'latest') return m
    if (cleanTag === 'latest' && mParsed.baseName === cleanBase && !mParsed.tag) return m
  }

  // 3. Namespace strip match (e.g. "adrienbrault/biomistral-7b:q4_k_m" vs "biomistral-7b:q4_k_m")
  for (const m of available) {
    const mParsed = parseModelTagComponents(m)
    const mWithoutNamespace = mParsed.namespace ? `${mParsed.baseName}${mParsed.tag ? `:${mParsed.tag}` : ''}` : mParsed.normalized
    if (mWithoutNamespace === cleanWithoutNamespace) return m

    // Also match namespace-stripped with :latest equivalence
    if (mWithoutNamespace === `${cleanWithoutNamespace}:latest` || `${mWithoutNamespace}:latest` === cleanWithoutNamespace) return m
    if (!cleanTag && mParsed.baseName === cleanBase && (mParsed.tag === 'latest' || !mParsed.tag)) return m
  }

  // 4. Exact base model match with compatible quant/instruction tag
  for (const m of available) {
    const mParsed = parseModelTagComponents(m)
    if (mParsed.baseName === cleanBase && isTagCompatible(cleanTag, mParsed.tag)) {
      return m
    }
  }

  // 5. Longest base prefix / family match (scored by longest matching base to prevent substring shadowing)
  let bestMatch: string | null = null
  let bestMatchScore = 0

  for (const m of available) {
    const mParsed = parseModelTagComponents(m)
    const mBase = mParsed.baseName

    if (!isTagCompatible(cleanTag, mParsed.tag)) {
      continue
    }

    if (mBase === cleanBase) {
      return m
    }

    if (mBase.startsWith(cleanBase) || cleanBase.startsWith(mBase)) {
      // Score based on length of common base prefix
      const commonLen = Math.min(mBase.length, cleanBase.length)
      if (commonLen > bestMatchScore) {
        bestMatchScore = commonLen
        bestMatch = m
      }
    }
  }

  if (bestMatch && bestMatchScore >= 4) {
    return bestMatch
  }

  return null
}

/**
 * Accurately determines if a target Ollama model tag is installed locally.
 */
export function isOllamaModelInstalled(targetModel: string, downloadedModels: string[]): boolean {
  return findMatchingInstalledModel(targetModel, downloadedModels) !== null
}
