export interface PatchHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

export interface UnifiedDiffResult {
  success: boolean
  updatedContent?: string
  appliedHunksCount: number
  error?: string
}

export class UnifiedDiffPatchApplier {
  /**
   * Parses standard Unified Diff patch string into structured hunks.
   */
  public static parseUnifiedDiff(diffString: string): PatchHunk[] {
    const hunks: PatchHunk[] = []
    const lines = diffString.replace(/\r\n/g, '\n').split('\n')
    let currentHunk: PatchHunk | null = null

    for (const line of lines) {
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      if (match) {
        if (currentHunk) {
          hunks.push(currentHunk)
        }
        currentHunk = {
          oldStart: parseInt(match[1], 10),
          oldLines: match[2] !== undefined ? parseInt(match[2], 10) : 1,
          newStart: parseInt(match[3], 10),
          newLines: match[4] !== undefined ? parseInt(match[4], 10) : 1,
          lines: [],
        }
      } else if (currentHunk) {
        if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) {
          currentHunk.lines.push(line)
        }
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk)
    }

    return hunks
  }

  /**
   * Applies unified diff hunks onto source file content with line offset tolerance.
   */
  public static applyPatch(fileContent: string, diffString: string): UnifiedDiffResult {
    const hunks = this.parseUnifiedDiff(diffString)
    if (hunks.length === 0) {
      return { success: false, appliedHunksCount: 0, error: 'No valid unified diff hunks found in input.' }
    }

    const lines = fileContent.replace(/\r\n/g, '\n').split('\n')
    let appliedCount = 0

    for (const hunk of hunks) {
      const searchLines = hunk.lines.filter((l) => !l.startsWith('+')).map((l) => l.slice(1))
      const replaceLines = hunk.lines.filter((l) => !l.startsWith('-')).map((l) => l.slice(1))

      if (searchLines.length === 0) continue

      const targetSearch = searchLines.join('\n')
      const targetReplace = replaceLines.join('\n')
      const currentFull = lines.join('\n')

      if (currentFull.includes(targetSearch)) {
        const updated = currentFull.replace(targetSearch, targetReplace)
        lines.length = 0
        lines.push(...updated.split('\n'))
        appliedCount++
      }
    }

    if (appliedCount === 0) {
      return { success: false, appliedHunksCount: 0, error: 'Failed applying unified diff hunks onto target content.' }
    }

    return {
      success: true,
      updatedContent: lines.join('\n'),
      appliedHunksCount: appliedCount,
    }
  }
}
