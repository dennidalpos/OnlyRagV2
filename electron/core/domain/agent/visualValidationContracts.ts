import { z } from 'zod'

const nonBlank = z.string().trim().min(1)

export const visualValidationViewportSchema = z.object({
  width: z.number().int().min(1).max(4096),
  height: z.number().int().min(1).max(4096),
}).strict()

export const visualValidationRequestSchema = z.object({
  artifactPath: nonBlank.max(4096),
  timeoutMs: z.number().int().min(100).max(120_000).default(30_000),
  viewport: visualValidationViewportSchema.default({ width: 1440, height: 900 }),
  captureScreenshot: z.boolean().default(true),
  captureDom: z.boolean().default(true),
}).strict()

export const visualValidationAvailabilitySchema = z.enum(['available', 'unavailable'])

export const visualValidationScreenshotSchema = z.object({
  status: visualValidationAvailabilitySchema,
  path: nonBlank.max(4096).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
}).strict().superRefine((screenshot, context) => {
  if (screenshot.status === 'available' && !screenshot.path) {
    context.addIssue({ code: 'custom', path: ['path'], message: 'An available screenshot requires a path' })
  }
})

export const visualValidationDomSchema = z.object({
  status: visualValidationAvailabilitySchema,
  content: z.string().max(1_000_000).optional(),
}).strict().superRefine((dom, context) => {
  if (dom.status === 'available' && dom.content === undefined) {
    context.addIssue({ code: 'custom', path: ['content'], message: 'An available DOM snapshot requires content' })
  }
})

export const visualValidationConsoleEntrySchema = z.object({
  level: z.enum(['debug', 'info', 'warning', 'error']),
  message: nonBlank.max(16_000),
}).strict()

export const visualValidationHttpEntrySchema = z.object({
  url: nonBlank.max(4096),
  status: z.number().int().min(100).max(599),
  method: z.string().trim().min(1).max(16),
}).strict()

export const visualValidationRedactionSchema = z.object({
  applied: z.boolean(),
  fields: z.array(nonBlank.max(100)).max(50),
}).strict()

export const visualValidationResultSchema = z.object({
  status: z.enum(['verified', 'failed', 'UNAVAILABLE']),
  screenshot: visualValidationScreenshotSchema,
  dom: visualValidationDomSchema,
  console: z.array(visualValidationConsoleEntrySchema).max(500),
  http: z.array(visualValidationHttpEntrySchema).max(500),
  redaction: visualValidationRedactionSchema,
  error: z.string().max(4000).optional(),
}).strict().superRefine((result, context) => {
  if (result.status === 'UNAVAILABLE' && !result.error) {
    context.addIssue({ code: 'custom', path: ['error'], message: 'UNAVAILABLE requires an explanation' })
  }
})
