import { z } from 'zod'

const promptHistoryOutcomeSchema = z.enum(['running', 'success', 'failed', 'cancelled', 'unknown'])

export const promptHistoryIndexPayloadSchema = z.object({
  id: z.string().trim().min(1).max(200),
  sessionId: z.string().trim().min(1).max(200),
  workspacePath: z.string().trim().min(1).max(4096),
  prompt: z.string().trim().min(1).max(100_000),
  summary: z.string().max(20_000).optional(),
  outcome: promptHistoryOutcomeSchema,
  startedAt: z.string().trim().min(1).max(100),
  completedAt: z.string().trim().min(1).max(100).optional(),
})

export const promptHistorySearchPayloadSchema = z.object({
  query: z.string().trim().min(1).max(100_000),
  topK: z.number().int().min(1).max(100).optional(),
  projectPaths: z.array(z.string().trim().min(1).max(4096)).max(100).optional(),
})
