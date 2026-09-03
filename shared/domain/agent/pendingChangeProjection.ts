/**
 * electron/core/domain/agent/pendingChangeProjection.ts
 *
 * Domain Layer — Projects what a pending file-mutating tool call WOULD write, without
 * touching the filesystem. Feeding the result to diffEngine.computeLineDiff against the
 * file's current content is what lets the approval UI show a real before/after diff
 * instead of just echoing the replacement text back at the user.
 *
 * The semantics deliberately mirror agentToolExecutorService's own handlers: a single
 * replacement substitutes the first occurrence, multi-replace applies its chunks in order.
 */

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

/** True when the proposal's target text cannot be located, so the edit would not apply. */
export function isProposalApplicable(proposal: PendingChangeProposal, before: string): boolean {
  if (proposal.type === 'replace_chunk') {
    return Boolean(proposal.targetContent) && before.includes(String(proposal.targetContent))
  }
  if (proposal.type === 'multi_replace') {
    return (proposal.replacements || []).some((c) => c?.targetContent && before.includes(c.targetContent))
  }
  return true
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
