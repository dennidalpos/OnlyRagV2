/**
 * electron/core/domain/agent/turnContextPolicy.ts
 *
 * Domain Layer — Which context blocks this turn is allowed to carry.
 *
 * The orchestrator already arbitrates one thing per turn: WHAT to say, in
 * planDirectiveArbiter.ts. It never arbitrated the second half of the same question — WHAT TO
 * SHOW. Every optional block went out on every turn, sized by fixed shares of the context
 * budget (repo map 18%, RAG 12% in agentPromptAssembler.ts; pinned/active/skills at fixed
 * fractions of tier 2 in heuristicContextCompactor.ts). On a 7B at 8k that spends half the
 * window on background the active milestone frequently has no use for, and the block that pays
 * for it is the tool history — the only one carrying what has already been done.
 *
 * This module closes that gap without adding any inference. The directive kind the arbiter
 * already resolved IS the answer to "what does the model need in front of it right now": a turn
 * whose prescribed action is `npm install react` needs the directive and nothing else, and a
 * repository map cannot make that command more correct.
 *
 * ## What can never be dropped
 *
 * The system prompt, the plan block and the tool history are deliberately absent from
 * `TurnContextPolicy`. There is no flag for them, so no policy can suppress them. They are the
 * immutable head and the progress tail — precisely what Ollama destroys when it clamps num_ctx
 * and truncates from the front (see selectModelForTurn in agentOrchestratorPromptAssembly.ts).
 * Suppressing an optional block frees its allocation for the history; suppressing the history
 * would leave the model re-deriving its own past every turn.
 *
 * This is blueprint §6.2 principle 1 ("structure before directives") applied to context rather
 * than to instructions: when the system already knows the turn's action, it should not make the
 * model rediscover which of eight blocks was relevant to it.
 */

import type { PlanDirectiveKind } from './planDirectiveArbiter'

/**
 * The optional blocks, and whether this turn carries them.
 *
 * Every field is a block that costs context and is not always earned. Blocks that are always
 * earned are not represented here at all — see the module docstring.
 */
export interface TurnContextPolicy {
  /** Compact semantic repo map. Costly: also a filesystem tree walk on every turn. */
  includeProjectMap: boolean
  /** RAG documents attached to the session. */
  includeAttachedRag: boolean
  /** Matched skill bodies (`skills/<name>/SKILL.md`). */
  includeSkills: boolean
  /** Files the user explicitly pinned into the session. */
  includePinnedFiles: boolean
  /** The file open in the editor. */
  includeActiveFile: boolean
  /** Why these blocks, in one clause — used verbatim in the turn's log line. */
  rationale: string
}

/** Ordinary progress: the model is choosing its own next edit and needs the full picture. */
const FULL: TurnContextPolicy = {
  includeProjectMap: true,
  includeAttachedRag: true,
  includeSkills: true,
  includePinnedFiles: true,
  includeActiveFile: true,
  rationale: 'ordinary milestone progress — full context',
}

/**
 * The directive names the exact command or the exact edit. Nothing in the background context can
 * change what that command is, so all of it is dead weight.
 */
function commandOnly(rationale: string): TurnContextPolicy {
  return {
    includeProjectMap: false,
    includeAttachedRag: false,
    includeSkills: false,
    includePinnedFiles: false,
    includeActiveFile: false,
    rationale,
  }
}

/**
 * The directive names a file to fix. The model needs the code and the conventions that govern
 * it, but not the repository map (it already knows which file) nor the RAG corpus.
 */
function codeFixOnly(rationale: string): TurnContextPolicy {
  return {
    includeProjectMap: false,
    includeAttachedRag: false,
    includeSkills: true,
    includePinnedFiles: true,
    includeActiveFile: true,
    rationale,
  }
}

/**
 * Resolves the blocks admitted this turn from the directive the arbiter already chose.
 *
 * Written as an exhaustive `switch` with no `default`: a new `PlanDirectiveKind` becomes a
 * compile error here rather than silently inheriting whatever the fallback happened to be. A
 * new directive state must state what its turn needs to see.
 */
export function resolveTurnContextPolicy(kind: PlanDirectiveKind): TurnContextPolicy {
  switch (kind) {
    // The action is `finish`. The model needs the closure directive and the finish schema.
    case 'session_closure':
      return commandOnly('closing the session — directive only')

    // The action is a literal install command, already composed with the exact package name and
    // version range (see npmResolutionConflict.ts and buildUndeclaredDependencyDirective).
    case 'dependencies_undeclared':
      return commandOnly('installing undeclared imports — directive names the exact command')
    case 'dependencies_missing':
      return commandOnly('installing declared dependencies — directive names the exact command')

    // The action is the project's own verification command, resolved by projectVerificationResolver.
    case 'verification_due':
      return commandOnly('running project verification — directive names the exact command')

    // These name a file and a reason. Background context cannot improve the edit; the file's own
    // conventions can.
    case 'dependencies_uninstallable':
      return codeFixOnly('rewriting an unresolvable import — code context only')
    case 'verification_failing':
      return codeFixOnly('fixing a compiler diagnostic — code context only')

    // The fix is a single exact `<script>` tag, composed by entrypointIntegrity.ts. Pinned files
    // stay because the entry HTML is frequently one of them.
    case 'entrypoint_disconnected':
      return {
        includeProjectMap: false,
        includeAttachedRag: false,
        includeSkills: false,
        includePinnedFiles: true,
        includeActiveFile: false,
        rationale: 'reconnecting the HTML entrypoint — directive carries the exact tag',
      }

    // The action is `update_plan <id>`: a plan mutation. No file is read or written.
    case 'unprovable_milestone':
      return commandOnly('closing an unprovable milestone — plan mutation only')

    case 'focus':
      return FULL
  }
}

/** The blocks this policy withheld, for the turn's log line. Empty when it withheld none. */
export function omittedBlockNames(policy: TurnContextPolicy): string[] {
  const omitted: string[] = []
  if (!policy.includeProjectMap) omitted.push('repo map')
  if (!policy.includeAttachedRag) omitted.push('RAG docs')
  if (!policy.includeSkills) omitted.push('skills')
  if (!policy.includePinnedFiles) omitted.push('pinned files')
  if (!policy.includeActiveFile) omitted.push('active file')
  return omitted
}
