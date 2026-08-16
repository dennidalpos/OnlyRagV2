export interface FileInspectionFact {
  filePath: string
  lastInspectedStep: number
  exports: string[]
  symbolsSummary: string
  keyLinesSnippet: string
}

/**
   * Virtual Memory Store: Retains persistent knowledge of inspected files across all steps
   * so small local models (3B/7B/8B) never need to re-read files they inspected in earlier steps.
 */
export class VirtualMemorySymbolStore {
  private fileFacts = new Map<string, FileInspectionFact>()

  /**
   * Record file inspection knowledge.
   */
  public recordFileFact(filePath: string, step: number, exports: string[], summary: string, keySnippet: string): void {
    this.fileFacts.set(filePath, {
      filePath,
      lastInspectedStep: step,
      exports,
      symbolsSummary: summary,
      keyLinesSnippet: keySnippet.slice(0, 1500),
    })
  }

  /**
   * Check if file knowledge exists.
   */
  public hasFileFact(filePath: string): boolean {
    return this.fileFacts.has(filePath)
  }

  /**
   * Get file fact.
   */
  public getFileFact(filePath: string): FileInspectionFact | undefined {
    return this.fileFacts.get(filePath)
  }

  /**
   * Compile virtual memory block for system prompt context injection.
   */
  public compileVirtualMemoryBlock(): string {
    if (this.fileFacts.size === 0) return ''

    const facts: string[] = []
    for (const [path, fact] of this.fileFacts.entries()) {
      facts.push(`- 📄 ${path} (inspected step ${fact.lastInspectedStep}): exports=[${fact.exports.join(', ')}] | summary: ${fact.symbolsSummary}`)
    }

    return `[VIRTUAL MEMORY STORE (PREVIOUSLY INSPECTED FILES - DO NOT RE-READ UNLESS MODIFIED)]\n${facts.join('\n')}\n[END VIRTUAL MEMORY]`
  }

  public reset(): void {
    this.fileFacts.clear()
  }
}
