/**
 * Unprovable Active Milestone Directive.
 *
 * The plan block's focus directive 2 has always read:
 *
 *   "Once the required files for this milestone are created or updated, invoke `update_plan`
 *    to mark it verified or proceed directly to the next milestone."
 *
 * For a milestone that names no file, that instruction cannot be carried out. It promises the
 * model a path to closure — write the files — that does not exist, and says nothing about the
 * one that does.
 *
 * Observed in the live-full-task run of 2026-08-24. Milestone m-10 was "Create `src/services`
 * folder": `extractDeliverablePaths` finds no token there, because a directory has no
 * extension, so the milestone resolves `not_applicable` and no verification can ever promote
 * it. The model did the only thing directive 2 suggested and wrote a file into the folder —
 * three times, at steps 22, 23 and 24, each with a DIFFERENT throwaway body:
 *
 *   step 22  `// Placeholder for services` + a `fetchData` stub
 *   step 23  `// Placeholder for service functions` + `getTasks` / `addTask` stubs
 *   step 24  `// Placeholder content for services folder` + `export default {}`
 *
 * This is why `redundantWriteDetector` never fired and was right not to: every write really
 * did change the file. The model was not repeating itself out of amnesia — it was trying
 * different content because nothing it wrote could ever close the milestone, and the prompt
 * kept telling it that writing was the way. The thrashing guard blocked it at step 25 and the
 * loop guard abandoned m-10 as FAILED, spending seven steps of a fifty-step budget.
 *
 * The exit already exists and was never named: `milestoneUpdateAuthority` deliberately leaves
 * a milestone that names no artefact closeable by `update_plan`, precisely because there is
 * nothing on disk that could contradict the model's own judgement. This module says so, at
 * the moment the model is working that milestone.
 *
 * Pure domain: the caller supplies the milestone and its deliverable status.
 */

import type { PlanMilestone } from './planAndSolveGraph'

/**
 * Replaces focus directive 2 when the active milestone names no artefact.
 *
 * States the fact before the instruction: a model told only "call update_plan" will still try
 * to earn the right to call it. What unblocks it is knowing that there is nothing to earn —
 * no file it can write and no command it can run will move this milestone, so its own
 * assessment is the only instrument that applies.
 *
 * The directive deliberately does NOT tell the model to skip the work. "Ensure buttons have a
 * 44x44 touch target" describes real work in files that already exist; only its *proof* is
 * missing. Telling the model to just close it would turn every unprovable milestone into a
 * rubber stamp, which is the failure `milestoneVerificationPromotion` was written to end.
 */
export function buildUnprovableMilestoneDirective(milestone: Pick<PlanMilestone, 'id' | 'title'>): string {
  // "No command can prove it" has to be literally true, which is why the caller must have
  // ruled out a verificationCommand first — see shouldDirectUnprovableClosure.
  return [
    `2. THIS MILESTONE NAMES NO FILE. No write and no command can prove it, so it will stay open until you close it yourself — creating a new file will NOT satisfy it and will be blocked as a loop.`,
    `   Do the work it describes inside the files that already exist, then call "update_plan" with milestoneId "${milestone.id}" and status "verified", judging for yourself whether "${milestone.title}" is done.`,
  ].join('\n')
}

/**
 * Whether the plan block should carry the directive above.
 *
 * Two conditions, and the second was missing from the first draft.
 *
 * `not_applicable` means what the resolver documents: the title names no path, so nothing on
 * disk can attest to the milestone either way. An `unsatisfied` milestone has files that are
 * genuinely missing and must keep asking for them.
 *
 * A `verificationCommand` disqualifies the milestone even so, because `update_plan` RUNS that
 * command and promotes on its exit code (see agentOrchestratorPlanTool.ts) — so a command
 * demonstrably CAN prove it, and the directive's central claim would be false. The live
 * run of 2026-08-24 put it on m-5 "Install Tailwind CSS", whose declared proof was
 * `npm install tailwindcss postcss autoprefixer`, under the sentence "No write and no command
 * can prove it". Telling a model to fall back on its own judgement while a real check is
 * available is the rubber stamp this codebase keeps having to remove.
 */
export function shouldDirectUnprovableClosure(
  activeMilestone: Pick<PlanMilestone, 'id' | 'title' | 'verificationCommand'> | null | undefined,
  deliverableStatus: 'satisfied' | 'unsatisfied' | 'not_applicable'
): boolean {
  if (!activeMilestone || deliverableStatus !== 'not_applicable') return false
  return !activeMilestone.verificationCommand?.trim()
}
