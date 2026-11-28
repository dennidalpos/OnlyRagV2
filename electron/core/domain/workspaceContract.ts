import { z } from 'zod'

const nonBlankPath = z.string().trim().min(1).max(4096)
const nonBlankText = z.string().trim().min(1).max(100_000)
const optionalPositiveInt = z.number().int().min(1).optional()

export const workspaceListFilesPayloadSchema = z
  .object({
    dirPath: nonBlankPath.optional(),
  })
  .strict()

export const workspaceReadFilePayloadSchema = z
  .object({
    filePath: nonBlankPath,
    startLine: optionalPositiveInt,
    endLine: optionalPositiveInt,
  })
  .strict()

export const workspaceWriteFilePayloadSchema = z
  .object({
    filePath: nonBlankPath,
    content: z.string().max(10_000_000),
    expectedContentHash: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/i)
      .optional(),
    workspaceRoot: nonBlankPath.optional(),
  })
  .strict()

export const workspaceExecutePowerShellPayloadSchema = z
  .object({
    command: nonBlankText,
    cwd: nonBlankPath.optional(),
    timeoutMs: z.number().int().min(1).max(900_000).optional(),
  })
  .strict()
