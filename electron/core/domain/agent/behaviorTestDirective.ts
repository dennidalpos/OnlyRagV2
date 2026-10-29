/** Carries a milestone that promises behavior from "test file on disk" to "npm test passed". */

import { isCompletionMilestoneTitle } from '../../../../shared/domain/agent/planAndSolveGraph'
import type { PlanMilestone } from '../../../../shared/domain/agent/planAndSolveGraph'
import { isTerminatingScript } from './projectVerificationResolver'
import { requiresBehaviorEvidence } from './milestoneVerificationPromotion'

/** The command a behavioral milestone proposes; `npm run test` is the same script. */
export const BEHAVIOR_TEST_COMMAND = 'npm test'

export interface BehaviorTestRunner {
  /** The body the package.json "test" script should carry. */
  script: string
  /** The dev dependency that script needs, or null when Node ships the runner. */
  devPackage: string | null
}

/** The first open milestone that only a passing test can prove, or undefined. */
export function selectOpenBehaviorMilestone(milestones: readonly PlanMilestone[]): PlanMilestone | undefined {
  return milestones.find((m) => m.status !== 'verified' && m.status !== 'failed' && !isCompletionMilestoneTitle(m) && requiresBehaviorEvidence(m))
}

/** The runner the smoke-test milestone names (greenfieldScaffoldResolver.ts), defaulting to Vitest. */
export function resolveBehaviorTestRunner(milestone: PlanMilestone): BehaviorTestRunner {
  return /\bnode --test\b/.test(milestone.title) ? { script: 'node --test', devPackage: null } : { script: 'vitest run', devPackage: 'vitest' }
}

/** Test-runner CLIs and the package that provides each. */
const RUNNER_PACKAGES: Record<string, string> = { vitest: 'vitest', jest: 'jest', 'react-scripts': 'react-scripts', mocha: 'mocha' }

/** The package a script's runner CLI needs and the manifest does not declare, or null. */
export function undeclaredTestRunner(body: string, declaredPackages?: readonly string[]): string | null {
  if (!declaredPackages) return null
  const cli = body.trim().split(/\s+/)[0]
  const pkg = cli ? RUNNER_PACKAGES[cli] : undefined
  return pkg && !declaredPackages.includes(pkg) ? pkg : null
}

/**
 * Whether a package.json "test" script runs tests once: npm's placeholder, watch modes and a runner
 * the manifest never declares do not (`react-scripts test` with no react-scripts: full-task run 8).
 */
export function isUsableTestScript(body: string | null | undefined, declaredPackages?: readonly string[]): boolean {
  if (!body || !body.trim()) return false
  if (/no test specified/i.test(body)) return false
  if (undeclaredTestRunner(body, declaredPackages)) return false
  return isTerminatingScript(body)
}

/** Whether a command runs the package.json "test" script (`npm test`, `npm t`, `npm run test`). */
export function isProjectTestCommand(command: string): boolean {
  return /^npm\s+(?:run\s+)?(?:test|t)(?:\s|$)/i.test((command || '').trim())
}

function subjectOf(milestone: PlanMilestone): string {
  const file = milestone.filePaths?.[0]
  return file ? `"${file}" is on disk` : 'its test is on disk'
}

/** Ordered when the runner the "test" script needs is not declared: one install, nothing else. */
export function buildBehaviorTestRunnerInstallDirective(milestone: PlanMilestone, runner: BehaviorTestRunner): string {
  return [
    `[THE SMOKE TEST HAS NO RUNNER — INSTALL IT NOW]`,
    `Milestone ${milestone.id} promises behavior: ${subjectOf(milestone)}, but "${runner.devPackage}" is not declared in package.json, so nothing can run it. A build can never prove this milestone; only a passing "${BEHAVIOR_TEST_COMMAND}" can.`,
    `Directives:`,
    `1. Your next tool call MUST be "run_command" with the command: npm install --save-dev ${runner.devPackage}`,
    `2. Do NOT write any file this step.`,
  ].join('\n')
}

/** Ordered when package.json lacks a usable "test" script: add exactly that script. */
export function buildBehaviorTestScriptDirective(
  milestone: PlanMilestone,
  runner: BehaviorTestRunner,
  currentScript: string | null,
  declaredPackages?: readonly string[],
): string {
  const script = currentScript?.trim()
  const missingRunner = script ? undeclaredTestRunner(script, declaredPackages) : null
  const current = !script
    ? 'declares no "test" script'
    : missingRunner
      ? `declares "test": "${script}", but "${missingRunner}" is not a dependency, so it cannot run`
      : `declares "test": "${script}", which does not run the tests once and exit`
  return [
    `[PACKAGE.JSON HAS NO RUNNABLE "test" SCRIPT — ADD IT NOW]`,
    `Milestone ${milestone.id} promises behavior: ${subjectOf(milestone)}, but package.json ${current}, so "${BEHAVIOR_TEST_COMMAND}" cannot run it. A build can never prove this milestone; only a passing "${BEHAVIOR_TEST_COMMAND}" can.`,
    `Directives:`,
    `1. Your next tool call MUST be "write_file" on "package.json": the complete file, unchanged except that "scripts" contains "test": "${runner.script}".`,
    `2. Do NOT remove any existing script or dependency, and do NOT write any other file this step.`,
  ].join('\n')
}
