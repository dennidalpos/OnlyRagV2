import type { PlanDirectiveKind } from './planDirectiveArbiter'

/** The optional blocks, and whether this turn carries them. */
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

/** Resolves the blocks admitted this turn from the directive the arbiter already chose. */
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
    case 'behavior_test_runner_missing':
      return commandOnly('installing the smoke-test runner — directive names the exact command')

    // These name a file and a reason. Background context cannot improve the edit; the file's own
    // conventions can.
    case 'dependencies_uninstallable':
      return codeFixOnly('rewriting an unresolvable import — code context only')
    case 'verification_failing':
      return codeFixOnly('fixing a compiler diagnostic — code context only')
    case 'dependencies_unpublished':
      return codeFixOnly('rewriting package.json ranges npm does not publish — code context only')
    case 'behavior_test_script_missing':
      return codeFixOnly('adding the package.json "test" script — code context only')

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
