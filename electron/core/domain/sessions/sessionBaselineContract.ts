import { z } from 'zod'

const nonBlankPath = z.string().trim().min(1).max(4096)
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, 'Expected a SHA-256 hex digest')
const isoTimestamp = z.string().datetime({ offset: true })

export const workspaceClassificationSchema = z.enum(['empty', 'existing', 'monorepo', 'multi-project'])

export const initialGitStateSchema = z.object({
  branch: z.string().trim().min(1).nullable(),
  commit: z.string().regex(/^[a-f0-9]{7,64}$/i).nullable(),
  isDirty: z.boolean(),
  statusHash: sha256.nullable(),
}).strict()

export const sessionManifestSchema = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string().trim().min(1).max(200),
  workspaceRoot: nonBlankPath,
  startedAt: isoTimestamp,
  workspaceClassification: workspaceClassificationSchema,
  initialGit: initialGitStateSchema,
  manifestHash: sha256,
  configHash: sha256,
}).strict()

export const baselineEntrySchema = z.object({
  relativePath: nonBlankPath,
  state: z.enum(['missing', 'file', 'directory']),
  contentHash: sha256.optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
}).strict().superRefine((entry, context) => {
  if (entry.state === 'file' && !entry.contentHash) {
    context.addIssue({ code: 'custom', path: ['contentHash'], message: 'Files require a content hash' })
  }
  if (entry.state !== 'file' && (entry.contentHash !== undefined || entry.sizeBytes !== undefined)) {
    context.addIssue({ code: 'custom', path: ['state'], message: 'Only file entries may contain content metadata' })
  }
})

export const baselineSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  snapshotId: z.string().trim().min(1).max(200),
  sessionId: z.string().trim().min(1).max(200),
  workspaceRoot: nonBlankPath,
  capturedAt: isoTimestamp,
  checkpoint: z.number().int().nonnegative(),
  entries: z.array(baselineEntrySchema).max(100_000),
}).strict()

export type WorkspaceClassification = z.infer<typeof workspaceClassificationSchema>
export type InitialGitState = z.infer<typeof initialGitStateSchema>
export type SessionManifest = z.infer<typeof sessionManifestSchema>
export type BaselineEntry = z.infer<typeof baselineEntrySchema>
export type BaselineSnapshot = z.infer<typeof baselineSnapshotSchema>
