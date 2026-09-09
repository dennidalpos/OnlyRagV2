import { z } from 'zod'

const nonEmptyText = z.string().trim().min(1)

const interviewQuestionSchema = z.object({
  id: nonEmptyText,
  question: nonEmptyText,
  rationale: nonEmptyText.max(240),
  options: z.array(nonEmptyText).min(2).max(3).superRefine((options, ctx) => {
    const normalized = options.map((option) => option.toLocaleLowerCase())
    if (new Set(normalized).size !== normalized.length) {
      ctx.addIssue({ code: 'custom', message: 'Options must be distinct' })
    }
  }),
  recommendedIndex: z.number().int().nonnegative(),
}).strict()

export const interviewPhaseResponseSchema = z.object({
  hasQuestions: z.boolean(),
  questions: z.array(interviewQuestionSchema).max(2),
}).strict().superRefine((value, ctx) => {
  if (value.hasQuestions !== (value.questions.length > 0)) {
    ctx.addIssue({ code: 'custom', message: 'hasQuestions must match whether questions are present' })
  }
  const ids = value.questions.map((question) => question.id.toLocaleLowerCase())
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: 'custom', path: ['questions'], message: 'Question IDs must be unique' })
  }
  value.questions.forEach((question, index) => {
    if (question.recommendedIndex >= question.options.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['questions', index, 'recommendedIndex'],
        message: 'recommendedIndex must reference an available option',
      })
    }
  })
})

export const planningPhaseResponseSchema = z.object({
  objective: nonEmptyText,
  assumptions: z.array(z.object({
    id: nonEmptyText,
    statement: nonEmptyText,
    rationale: nonEmptyText.max(240),
  }).strict()).max(5),
  interventions: z.array(z.object({
    id: nonEmptyText,
    objective: nonEmptyText,
    filePaths: z.array(nonEmptyText).max(1),
    acceptanceCriteria: z.array(nonEmptyText).min(1).max(3),
    verificationCommand: nonEmptyText.optional(),
    sourceInterventionId: nonEmptyText.optional(),
  }).strict().superRefine((intervention, ctx) => {
    if (intervention.filePaths.length === 0 && !intervention.verificationCommand) {
      ctx.addIssue({ code: 'custom', message: 'An intervention needs a filePath or verificationCommand' })
    }
  })).min(1).max(15),
  supersededWork: z.array(z.object({
    interventionId: nonEmptyText,
    reason: nonEmptyText.max(240),
  }).strict()).max(15),
}).strict()

export type PlanningPhaseResponse = z.infer<typeof planningPhaseResponseSchema>

export type StructuredValidationResult<T> =
  | { status: 'valid'; data: T }
  | { status: 'invalid'; error: string }

export function toOllamaJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>
}

export function validateStructuredContent<T>(content: string, schema: z.ZodType<T>): StructuredValidationResult<T> {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return { status: 'invalid', error: 'Response is not valid JSON' }
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    const error = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || 'response'}: ${issue.message}`)
      .join('; ')
    return { status: 'invalid', error }
  }
  return { status: 'valid', data: result.data }
}
