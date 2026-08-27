import { z } from 'zod'

const workspacePath = z.string().trim().min(1).max(4096)
const artifactId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const artifactName = z.string().trim().min(1).max(200)
const artifactKind = z.enum(['html', 'svg', 'markdown'])

export const artifactsListPayloadSchema = z.object({ workspacePath }).strict()
export const artifactsGetPayloadSchema = z.object({ workspacePath, artifactId }).strict()
export const artifactsDeletePayloadSchema = z.object({ workspacePath, artifactId }).strict()
export const artifactsSavePayloadSchema = z.object({
  workspacePath,
  input: z.object({
    id: artifactId.optional(),
    name: artifactName,
    kind: artifactKind,
    content: z.string().max(2_000_000),
  }).strict(),
}).strict()
