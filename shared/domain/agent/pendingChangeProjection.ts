export type PendingMutationType = 'write_file' | 'replace_chunk' | 'multi_replace' | 'delete_file'

export interface PendingChangeProposal {
  type: PendingMutationType
  /** Full replacement content for write_file. */
  content?: string
  /** Search text for replace_chunk. */
  targetContent?: string
  /** Substitute text for replace_chunk. */
  replacementContent?: string
  /** Ordered chunks for multi_replace. */
  replacements?: Array<{ targetContent?: string; replacementContent?: string }>
}

/** The exact content the workspace file would hold once this proposal is executed. */
export function projectPendingChange(proposal: PendingChangeProposal, before: string): string {
  const current = before ?? ''

  switch (proposal.type) {
    case 'write_file':
      return String(proposal.content ?? '')

    case 'delete_file':
      return ''

    case 'replace_chunk': {
      const target = String(proposal.targetContent ?? '')
      if (!target || !current.includes(target)) return current
      return current.replace(target, String(proposal.replacementContent ?? ''))
    }

    case 'multi_replace': {
      let projected = current
      for (const chunk of proposal.replacements || []) {
        const target = chunk?.targetContent
        if (target && projected.includes(target)) {
          projected = projected.replace(target, String(chunk.replacementContent ?? ''))
        }
      }
      return projected
    }

    default:
      return current
  }
}
