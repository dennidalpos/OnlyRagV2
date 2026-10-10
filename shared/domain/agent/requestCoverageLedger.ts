import { z } from 'zod'

const text = z.string().trim().min(1).max(2000)
const uniqueTexts = z
  .array(text)
  .max(100)
  .refine((items) => new Set(items).size === items.length, 'Duplicate values')
export const requestObligationSchema = z
  .object({
    id: text,
    sourceLines: z.array(z.number().int().positive()).min(1).max(100),
    requirement: text,
    subject: text,
    scope: z.enum(['global', 'local', 'context']),
    targets: uniqueTexts,
    closedInventory: z.boolean(),
    conditions: uniqueTexts,
  })
  .strict()

export const requestCoverageLedgerSchema = z
  .object({
    request: z.string().min(1).max(200000),
    obligations: z.array(requestObligationSchema).min(1).max(100),
  })
  .strict()

export type RequestCoverageLedger = z.infer<typeof requestCoverageLedgerSchema>

export const planCoverageClaimSchema = z
  .object({
    evidenceId: z.number().int().positive(),
    obligationId: text,
    subject: text,
    scope: z.enum(['global', 'local']),
    targets: uniqueTexts,
    conditions: uniqueTexts,
  })
  .strict()
export type PlanCoverageClaim = z.infer<typeof planCoverageClaimSchema>
export interface CoverageEvidence {
  id: number
  interventionId: string
  statement: string
  source: 'planned' | 'retained'
}

/** The confirmed request must account for every nonblank source line. */
export function validateRequestLedger(input: unknown, prompt: string): string | undefined {
  const parsed = requestCoverageLedgerSchema.safeParse(input)
  if (!parsed.success) return `Invalid request coverage ledger: ${parsed.error.issues[0]?.message}`
  const ledger = parsed.data
  if (ledger.request !== prompt) return 'Request coverage confirmation belongs to a different request'
  const lines = new Set(prompt.split(/\r?\n/).flatMap((line, index) => (line.trim() ? [index + 1] : [])))
  const reviewed = new Set<number>()
  const ids = new Set<string>()
  for (const item of ledger.obligations) {
    if (ids.has(item.id)) return `Duplicate obligation: ${item.id}`
    ids.add(item.id)
    if (new Set(item.sourceLines).size !== item.sourceLines.length || item.sourceLines.some((line) => !lines.has(line)))
      return `Invalid source lines: ${item.id}`
    item.sourceLines.forEach((line) => reviewed.add(line))
    if (item.scope === 'local' && item.targets.length === 0) return `Local obligation needs explicit targets: ${item.id}`
    if (item.scope !== 'context' && item.closedInventory && item.targets.length === 0) return `Closed inventory needs explicit targets: ${item.id}`
  }
  const omitted = [...lines].filter((line) => !reviewed.has(line))
  return omitted.length ? `Request ledger omitted source lines: ${omitted.join(', ')}` : undefined
}

/** Scope declarations are checked before the semantic comparison. */
export function validateCoverageClaims(ledger: RequestCoverageLedger, evidence: readonly CoverageEvidence[], input: unknown): string | undefined {
  const parsed = z.array(planCoverageClaimSchema).max(300).safeParse(input)
  if (!parsed.success) return `Invalid plan coverage claims: ${parsed.error.issues[0]?.message}`
  const ids = new Set(evidence.map((item) => item.id))
  const obligations = new Map(ledger.obligations.map((item) => [item.id, item]))
  const seen = new Set<string>()
  for (const claim of parsed.data) {
    const item = obligations.get(claim.obligationId)
    if (!item || item.scope === 'context' || !ids.has(claim.evidenceId)) return `Unavailable coverage reference: ${claim.obligationId}/${claim.evidenceId}`
    const key = `${claim.obligationId}:${claim.evidenceId}`
    if (seen.has(key)) return `Duplicate coverage reference: ${key}`
    seen.add(key)
    if (claim.subject !== item.subject) return `Coverage subject differs: ${item.id}`
    if (claim.conditions.length !== item.conditions.length || item.conditions.some((condition) => !claim.conditions.includes(condition)))
      return `Coverage conditions differ: ${item.id}`
  }
  for (const item of ledger.obligations.filter((item) => item.scope !== 'context')) {
    const claims = parsed.data.filter((claim) => claim.obligationId === item.id)
    if (!claims.length) return `Plan request coverage failed: missing obligation ${item.id}`
    if (claims.some((claim) => claim.scope === 'global')) continue
    if (item.scope === 'global' && !item.closedInventory) return `Plan request coverage failed: local criteria cannot cover open global obligation ${item.id}`
    const targets = new Set(claims.flatMap((claim) => claim.targets))
    const requiredTargets =
      item.scope === 'global'
        ? [...item.targets, ...parsed.data.filter((claim) => claim.subject === item.subject).flatMap((claim) => claim.targets)]
        : item.targets
    if (requiredTargets.some((target) => !targets.has(target))) return `Plan request coverage failed: incomplete target set for ${item.id}`
  }
  return undefined
}
