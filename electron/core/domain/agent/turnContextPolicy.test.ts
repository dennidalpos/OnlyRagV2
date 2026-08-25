import { describe, it, expect } from 'vitest'

import { resolveTurnContextPolicy, omittedBlockNames, type TurnContextPolicy } from './turnContextPolicy'
import type { PlanDirectiveKind } from './planDirectiveArbiter'

/**
 * The prompt used to carry every optional block on every turn, sized by fixed shares of the
 * context budget. On a turn whose entire prescribed action is `npm install react`, the repo map,
 * the RAG corpus and the skill bodies were still assembled and sent — and the block that paid
 * for them, once HeuristicContextCompactor ran out of room, was the tool history.
 *
 * These tests pin the two properties that make that safe to stop doing: that a turn whose action
 * is a named command carries nothing extra, and that no policy can ever withhold the blocks the
 * agent cannot work without.
 */

/** Every kind the arbiter can produce. Kept literal so a new kind fails the exhaustiveness test. */
const ALL_KINDS: PlanDirectiveKind[] = [
  'session_closure',
  'dependencies_undeclared',
  'dependencies_uninstallable',
  'dependencies_missing',
  'verification_due',
  'verification_failing',
  'entrypoint_disconnected',
  'unprovable_milestone',
  'focus',
]

const OPTIONAL_FLAGS = [
  'includeProjectMap',
  'includeAttachedRag',
  'includeSkills',
  'includePinnedFiles',
  'includeActiveFile',
] as const

describe('resolveTurnContextPolicy', () => {
  it('returns a fully populated policy for every directive kind', () => {
    for (const kind of ALL_KINDS) {
      const policy = resolveTurnContextPolicy(kind)
      expect(policy, kind).toBeDefined()
      for (const flag of OPTIONAL_FLAGS) {
        expect(typeof policy[flag], `${kind}.${flag}`).toBe('boolean')
      }
      expect(policy.rationale.length, `${kind}.rationale`).toBeGreaterThan(0)
    }
  })

  it('admits every optional block on an ordinary progress turn', () => {
    const policy = resolveTurnContextPolicy('focus')
    for (const flag of OPTIONAL_FLAGS) {
      expect(policy[flag], flag).toBe(true)
    }
    expect(omittedBlockNames(policy)).toEqual([])
  })

  it('withholds every optional block when the directive names the exact command', () => {
    // The install command is composed verbatim by npmResolutionConflict.ts / the undeclared
    // dependency directive. No amount of repository context can make it more correct.
    for (const kind of ['dependencies_undeclared', 'dependencies_missing', 'verification_due', 'session_closure', 'unprovable_milestone'] as const) {
      const policy = resolveTurnContextPolicy(kind)
      for (const flag of OPTIONAL_FLAGS) {
        expect(policy[flag], `${kind}.${flag}`).toBe(false)
      }
      expect(omittedBlockNames(policy).length, kind).toBe(OPTIONAL_FLAGS.length)
    }
  })

  it('keeps the code context, and only the code context, when the directive names a file to fix', () => {
    for (const kind of ['verification_failing', 'dependencies_uninstallable'] as const) {
      const policy = resolveTurnContextPolicy(kind)
      expect(policy.includeSkills, kind).toBe(true)
      expect(policy.includePinnedFiles, kind).toBe(true)
      expect(policy.includeActiveFile, kind).toBe(true)
      // The directive already names the file; the map would only re-answer a settled question.
      expect(policy.includeProjectMap, kind).toBe(false)
      expect(policy.includeAttachedRag, kind).toBe(false)
    }
  })

  it('keeps pinned files for a disconnected entrypoint, since the entry HTML is usually pinned', () => {
    const policy = resolveTurnContextPolicy('entrypoint_disconnected')
    expect(policy.includePinnedFiles).toBe(true)
    expect(policy.includeProjectMap).toBe(false)
  })

  it('never exposes a flag for the system prompt, the plan block or the tool history', () => {
    // This is the invariant, and it is enforced structurally rather than by assertion: those
    // three blocks have no field in TurnContextPolicy, so no policy value can suppress them.
    // The test guards against a future field being added that would let one.
    const keys = Object.keys(resolveTurnContextPolicy('focus')) as (keyof TurnContextPolicy)[]
    expect(keys.sort()).toEqual([...OPTIONAL_FLAGS, 'rationale'].sort())
  })
})

describe('omittedBlockNames', () => {
  it('names each withheld block for the turn log', () => {
    expect(omittedBlockNames(resolveTurnContextPolicy('verification_due'))).toEqual([
      'repo map',
      'RAG docs',
      'skills',
      'pinned files',
      'active file',
    ])
  })
})
