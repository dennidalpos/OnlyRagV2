export interface OllamaContextBaseline {
  model: string
  stableSection: string
  historyBlock: string
  contextTokens: number[]
}

export interface OllamaContextReuseParams {
  targetModel: string
  stableSection: string
  historyBlock: string
  turnSuffix: string
  /** The complete prompt to fall back to when reuse isn't safe (post-compaction, if applicable). */
  fullPrompt: string
  /** True when HeuristicContextCompactor rewrote the prompt this turn — invalidates the baseline. */
  wasCompacted: boolean
  baseline: OllamaContextBaseline | null
}

export interface OllamaContextReuseDecision {
  reusedContext: boolean
  contextTokens?: number[]
  promptToSend: string
}

export function resolveOllamaContextReuse(params: OllamaContextReuseParams): OllamaContextReuseDecision {
  const { targetModel, stableSection, historyBlock, turnSuffix, fullPrompt, wasCompacted, baseline } = params

  const canReuse =
    !wasCompacted &&
    baseline !== null &&
    baseline.model === targetModel &&
    baseline.stableSection === stableSection &&
    historyBlock.startsWith(baseline.historyBlock)

  if (!canReuse || !baseline) {
    return { reusedContext: false, promptToSend: fullPrompt }
  }

  const historyDelta = historyBlock.slice(baseline.historyBlock.length)
  const promptToSend = [historyDelta, turnSuffix].filter((p) => Boolean(p && p.trim())).join('\n\n')

  return { reusedContext: true, contextTokens: baseline.contextTokens, promptToSend }
}
