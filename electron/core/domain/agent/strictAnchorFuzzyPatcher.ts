export interface StrictPatchResult {
  allowed: boolean
  matchedOccurrences: number
  error?: string
}

/**
 * Strict Anchor Fuzzy Patcher: Guarantees target chunks match uniquely within the file
 * to prevent small local models from patching the wrong line in repetitive boilerplate code.
 */
export class StrictAnchorFuzzyPatcher {
  /**
   * Verifies that the target search chunk matches uniquely within the destination file.
   */
  public static verifyUniqueMatch(fileContent: string, targetChunk: string): StrictPatchResult {
    if (!targetChunk || !targetChunk.trim()) {
      return { allowed: false, matchedOccurrences: 0, error: 'Target chunk is empty.' }
    }

    const normFile = fileContent.replace(/\r\n/g, '\n')
    const normTarget = targetChunk.replace(/\r\n/g, '\n').trim()

    const lines = normFile.split('\n')
    const targetLines = normTarget.split('\n')

    let occurrences = 0
    for (let i = 0; i <= lines.length - targetLines.length; i++) {
      const windowChunk = lines.slice(i, i + targetLines.length).join('\n').trim()
      if (windowChunk === normTarget) {
        occurrences++
      }
    }

    if (occurrences === 0) {
      return { allowed: false, matchedOccurrences: 0, error: 'Target chunk not found in file.' }
    }

    if (occurrences > 1) {
      return {
        allowed: false,
        matchedOccurrences: occurrences,
        error: `Ambiguous target chunk: Matched ${occurrences} times in file. Include 2-3 additional surrounding context lines to make target chunk unique.`,
      }
    }

    return { allowed: true, matchedOccurrences: 1 }
  }
}
