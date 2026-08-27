import { z } from 'zod'

const nonBlank = z.string().trim().min(1).max(4096)
const isoTimestamp = z.string().datetime({ offset: true })

/** The only policy modes exposed to tool-capability decisions. */
export const capabilityPolicyModeSchema = z.enum(['offline-strict', 'local-only', 'network-approved'])

/** Coarse capabilities used by the policy gateway; tool handlers must not invent new ones. */
export const capabilitySchema = z.enum(['filesystem', 'shell', 'http-download', 'git', 'browser'])

export const capabilityOperationSchema = z.enum([
  'read',
  'write',
  'delete',
  'execute',
  'connect',
  'download',
  'commit',
  'open',
])

export const capabilityConsentSchema = z.object({
  requested: z.boolean(),
  granted: z.boolean(),
  consentId: z.string().trim().min(1).max(200).optional(),
}).strict().superRefine((consent, context) => {
  if (consent.granted && !consent.requested) {
    context.addIssue({ code: 'custom', path: ['requested'], message: 'Granted consent must have been requested' })
  }
  if (consent.granted && !consent.consentId) {
    context.addIssue({ code: 'custom', path: ['consentId'], message: 'Granted consent requires a consent id' })
  }
})

export const capabilityLimitsSchema = z.object({
  maxBytes: z.number().int().positive().max(1_000_000_000).optional(),
  timeoutMs: z.number().int().positive().max(900_000).optional(),
  maxResults: z.number().int().positive().max(100_000).optional(),
}).strict()

/** Input presented to the gateway before any external or mutating effect occurs. */
export const capabilityPolicyRequestSchema = z.object({
  sessionId: nonBlank.max(200),
  toolName: nonBlank.max(200),
  capability: capabilitySchema,
  operation: capabilityOperationSchema,
  mode: capabilityPolicyModeSchema,
  workspaceRoot: nonBlank,
  target: nonBlank.optional(),
  consent: capabilityConsentSchema,
  limits: capabilityLimitsSchema.optional(),
}).strict()

export const capabilityPolicyDecisionSchema = z.object({
  allowed: z.boolean(),
  reason: nonBlank.max(2000),
  requiresConsent: z.boolean(),
  auditId: nonBlank.max(200),
}).strict()

export const capabilityPolicyAuditEventSchema = z.object({
  auditId: nonBlank.max(200),
  sessionId: nonBlank.max(200),
  timestamp: isoTimestamp,
  capability: capabilitySchema,
  operation: capabilityOperationSchema,
  toolName: nonBlank.max(200),
  target: nonBlank.optional(),
  mode: capabilityPolicyModeSchema,
  allowed: z.boolean(),
  reason: nonBlank.max(2000),
  consentId: z.string().trim().min(1).max(200).optional(),
}).strict()

export type CapabilityPolicyMode = z.infer<typeof capabilityPolicyModeSchema>
export type Capability = z.infer<typeof capabilitySchema>
export type CapabilityOperation = z.infer<typeof capabilityOperationSchema>
export type CapabilityConsent = z.infer<typeof capabilityConsentSchema>
export type CapabilityLimits = z.infer<typeof capabilityLimitsSchema>
export type CapabilityPolicyRequest = z.infer<typeof capabilityPolicyRequestSchema>
export type CapabilityPolicyDecision = z.infer<typeof capabilityPolicyDecisionSchema>
export type CapabilityPolicyAuditEvent = z.infer<typeof capabilityPolicyAuditEventSchema>

export interface CapabilityPolicyGateway {
  authorize(request: CapabilityPolicyRequest): CapabilityPolicyDecision
  record(event: CapabilityPolicyAuditEvent): void
}
