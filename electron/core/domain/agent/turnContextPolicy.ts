import type { PlanDirectiveKind } from './planDirectiveArbiter'

/** Context block inclusion policy for an agent turn. */
export interface TurnContextPolicy {
  includeProjectMap: boolean
  includeAttachedRag: boolean
  includeSkills: boolean
  includePinnedFiles: boolean
  includeActiveFile: boolean
  rationale: string
}

/** Full context policy for milestone progress. */
const FULL: TurnContextPolicy = {
  includeProjectMap: true,
  includeAttachedRag: true,
  includeSkills: true,
  includePinnedFiles: true,
  includeActiveFile: true,
  rationale: 'ordinary milestone progress — full context',
}

/** Context policy for turns requiring only the command directive. */
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

/** Context policy for code-fix turns without project map or RAG. */
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

/** Resolves turn context policy based on plan directive kind. */
export function resolveTurnContextPolicy(kind: PlanDirectiveKind): TurnContextPolicy {
  switch (kind) {
    case 'session_closure':
      return commandOnly('closing the session — directive only')

    case 'dependencies_undeclared':
      return commandOnly('installing undeclared imports — directive names the exact command')
    case 'dependencies_missing':
      return commandOnly('installing declared dependencies — directive names the exact command')

    case 'verification_due':
      return commandOnly('running project verification — directive names the exact command')
    case 'behavior_test_runner_missing':
      return commandOnly('installing the smoke-test runner — directive names the exact command')

    case 'dependencies_uninstallable':
      return codeFixOnly('rewriting an unresolvable import — code context only')
    case 'verification_failing':
      return codeFixOnly('fixing a compiler diagnostic — code context only')
    case 'dependencies_unpublished':
      return codeFixOnly('rewriting package.json ranges npm does not publish — code context only')
    case 'behavior_test_script_missing':
      return codeFixOnly('adding the package.json "test" script — code context only')

    case 'entrypoint_disconnected':
      return {
        includeProjectMap: false,
        includeAttachedRag: false,
        includeSkills: false,
        includePinnedFiles: true,
        includeActiveFile: false,
        rationale: 'reconnecting the HTML entrypoint — directive carries the exact tag',
      }

    case 'unprovable_milestone':
      return commandOnly('closing an unprovable milestone — plan mutation only')

    case 'focus':
      return FULL
  }
}

/** Names of withheld blocks for logging. */
export function omittedBlockNames(policy: TurnContextPolicy): string[] {
  const omitted: string[] = []
  if (!policy.includeProjectMap) omitted.push('repo map')
  if (!policy.includeAttachedRag) omitted.push('RAG docs')
  if (!policy.includeSkills) omitted.push('skills')
  if (!policy.includePinnedFiles) omitted.push('pinned files')
  if (!policy.includeActiveFile) omitted.push('active file')
  return omitted
}
