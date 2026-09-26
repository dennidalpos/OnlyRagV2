import { z } from 'zod'

const short = z.string().trim().min(1).max(1024)
const path = z.string().trim().min(1).max(4096)
const text = z.string().max(120_000)
const largeText = z.string().max(10_000_000)

export const agentRunIdentitySchema = z.object({ runId: short, conversationId: short, planRevisionId: short, workspaceId: short }).strict()

export const activeFileContextSchema = z
  .object({
    name: z.string().trim().min(1).max(260),
    path,
    content: text,
    versionHash: z.string().regex(/^[a-f0-9]{64}$/i, 'Expected a SHA-256 content hash'),
  })
  .strict()

const capabilityProfileSchema = z
  .object({
    allowFileModifications: z.boolean(),
    allowTerminalExecution: z.boolean(),
    capabilityPolicyMode: z.enum(['offline-strict', 'local-only', 'network-approved']),
    maxToolCallSteps: z.number().int().nonnegative(),
  })
  .strict()

/** Settings are copied from the renderer's AppSettings and normalized by sanitizeAppSettings after validation. */
const settingsSnapshotSchema = z.record(z.string(), z.unknown())

/**
 * Complete renderer → Main contract for `agent:start-task`. Main-only fields such as
 * `sourceWorkspacePath` are rejected so the renderer cannot choose them.
 */
export const agentTaskRequestSchema = z
  .object({
    identity: agentRunIdentitySchema,
    sessionId: short.optional(),
    userTask: text,
    initialUserTask: text.optional(),
    agentMode: z.enum(['ask', 'guided', 'auto']).default('guided'),
    workspacePath: z.string().trim().max(4096).nullish(),
    isStandaloneMode: z.boolean().optional(),
    activeModel: z.string().trim().max(200).optional(),
    activeFile: activeFileContextSchema.nullish(),
    pinnedFiles: z
      .array(z.object({ name: z.string().max(260), path, content: largeText }).strict())
      .max(50)
      .optional(),
    attachedDocs: z
      .array(z.object({ id: short, filename: z.string().max(1024), extractedMarkdown: largeText }).strict())
      .max(50)
      .optional(),
    capabilityProfile: capabilityProfileSchema.optional(),
    forceContextCompaction: z.boolean().optional(),
    settings: settingsSnapshotSchema.optional(),
  })
  .strict()

/** Milestones seeded from an approved plan; unknown keys are stripped before they reach persisted session state. */
export const planMilestoneSchema = z.object({
  id: short,
  title: text,
  status: z.enum(['pending', 'in_progress', 'verified', 'failed']),
  filePaths: z.array(path).max(200).optional(),
  acceptanceCriteria: z.array(text).max(100).optional(),
  verificationReferences: z.array(text).max(100).optional(),
  sourceInterventionId: short.optional(),
  falsifiableHypothesis: text.optional(),
  verificationCommand: text.optional(),
  proposedVerificationCommand: text.optional(),
  fileEvidence: z.record(z.string().max(4096), z.string().max(256)).optional(),
  notes: text.optional(),
})

export const userInterviewAnswerSchema = z.object({
  questionId: short,
  questionText: text,
  selectedOption: text,
  isCustom: z.boolean().optional(),
  provenance: z.enum(['explicit', 'accepted_recommendation', 'unconfirmed_assumption']).optional(),
})

/**
 * Complete `AgentPlan` as the renderer sends it back for a revision (`agent:plan-generate`).
 * Unknown keys are stripped; every list field is required, as in `AgentPlan`.
 */
export const agentPlanSchema = z.object({
  formatVersion: z.literal(2),
  id: short,
  version: z.number().int().nonnegative(),
  prompt: text,
  originalPrompt: text.optional(),
  interviewAnswers: z.array(userInterviewAnswerSchema).max(50).optional(),
  objective: text,
  decisions: z
    .array(
      z.object({
        id: short,
        statement: text,
        source: z.enum(['explicit_user', 'accepted_recommendation', 'assumption']),
        rationale: text.optional(),
      }),
    )
    .max(200),
  retainedEvidence: z.array(z.object({ interventionId: short, summary: text, verificationReferences: z.array(text).max(100) })).max(200),
  supersededWork: z.array(z.object({ interventionId: short, reason: text })).max(200),
  status: z.enum(['idle', 'generating', 'ready', 'approved', 'rejected', 'error', 'cancelled']),
  errorPhase: z.enum(['interview', 'planning']).optional(),
  errorMessage: text.optional(),
  createdAt: short,
  baseStepOffset: z.number().int().nonnegative().optional(),
  milestones: z.array(planMilestoneSchema).max(100),
  approvalError: text.optional(),
  capabilityProfile: capabilityProfileSchema.optional(),
})
