import { z } from 'zod'

const nonBlankPath = z.string().trim().min(1).max(4096)
const nonBlankText = z.string().trim().min(1).max(100_000)
const optionalPositiveInt = z.number().int().min(1).optional()

export const workspaceListFilesPayloadSchema = z.object({
  targetPath: nonBlankPath.optional(),
}).strict()

export const workspaceProjectMapPayloadSchema = z.object({
  dirPath: nonBlankPath,
}).strict()

export const workspaceReadFilePayloadSchema = z.object({
  filePath: nonBlankPath,
  startLine: optionalPositiveInt,
  endLine: optionalPositiveInt,
}).strict()

export const workspaceWriteFilePayloadSchema = z.object({
  filePath: nonBlankPath,
  content: z.string().max(10_000_000),
}).strict()

export const workspaceReplaceChunkPayloadSchema = z.object({
  filePath: nonBlankPath,
  targetContent: z.string(),
  replacementContent: z.string(),
}).strict()

export const workspaceMultiReplaceChunksPayloadSchema = z.object({
  filePath: nonBlankPath,
  replacements: z.array(z.object({ targetContent: z.string(), replacementContent: z.string() }).strict()).max(100),
}).strict()

export const workspaceGrepSearchPayloadSchema = z.object({
  dirPath: nonBlankPath,
  query: nonBlankText,
  isRegex: z.boolean().optional(),
  caseInsensitive: z.boolean().optional(),
}).strict()

export const workspaceSearchWebPayloadSchema = z.object({
  query: nonBlankText,
  maxResults: optionalPositiveInt,
}).strict()

export const workspaceFetchWebPayloadSchema = z.object({
  url: nonBlankPath,
  maxChars: optionalPositiveInt,
}).strict()

export const workspaceDownloadFilePayloadSchema = z.object({
  url: nonBlankPath,
  targetFilePath: nonBlankPath,
  workspaceRoot: nonBlankPath.optional(),
}).strict()

export const workspaceGitCommitPayloadSchema = z.object({
  commitMessage: nonBlankText,
  workspaceRoot: nonBlankPath.optional(),
}).strict()

export const workspaceExecutePowerShellPayloadSchema = z.object({
  command: nonBlankText,
  targetCwd: nonBlankPath.optional(),
  timeoutMs: z.number().int().min(1).max(900_000).optional(),
}).strict()
