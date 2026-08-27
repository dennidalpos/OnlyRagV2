import { z } from 'zod'
import { projectVerificationStatusSchema } from './projectVerificationStatus'

const projectPath = z.string().trim().min(1).max(4096)
const factName = z.string().trim().min(1).max(200)

export const projectProfileClassificationSchema = z.enum(['empty', 'existing', 'monorepo', 'multi-project'])

export const projectProfileToolchainSchema = z.object({
  languages: z.array(factName).max(20),
  packageManagers: z.array(factName).max(20),
  testFrameworks: z.array(factName).max(20),
  buildTools: z.array(factName).max(20),
  declaredScripts: z.array(factName).max(100),
}).strict()

export const projectProfileVerificationCommandSchema = z.object({
  kind: z.enum(['build', 'typecheck', 'test', 'lint']),
  command: z.string().trim().min(1).max(2000),
  coverage: z.enum(['whole-project', 'entry-reachable']),
  source: z.string().trim().min(1).max(500),
}).strict()

export const projectProfileProjectSchema = z.object({
  id: z.string().trim().min(1).max(200),
  relativePath: projectPath,
  rootPath: projectPath,
  manifestFiles: z.array(projectPath).max(50),
  lockfiles: z.array(projectPath).max(50),
  toolchain: projectProfileToolchainSchema,
  verificationCommands: z.array(projectProfileVerificationCommandSchema).max(20),
  verificationStatus: projectVerificationStatusSchema.optional(),
}).strict()

export const projectProfileSchema = z.object({
  schemaVersion: z.literal(1),
  workspaceRoot: projectPath,
  classification: projectProfileClassificationSchema,
  projects: z.array(projectProfileProjectSchema).max(100),
}).strict().superRefine((profile, context) => {
  const projectCount = profile.projects.length
  if (profile.classification === 'empty' && projectCount !== 0) {
    context.addIssue({ code: 'custom', path: ['projects'], message: 'Empty workspaces cannot contain projects' })
  }
  if (profile.classification === 'existing' && projectCount !== 1) {
    context.addIssue({ code: 'custom', path: ['projects'], message: 'Existing workspaces require exactly one project' })
  }
  if ((profile.classification === 'monorepo' || profile.classification === 'multi-project') && projectCount < 2) {
    context.addIssue({ code: 'custom', path: ['projects'], message: 'Multi-project classifications require at least two projects' })
  }
})

export type ProjectProfileClassification = z.infer<typeof projectProfileClassificationSchema>
export type ProjectProfileProject = z.infer<typeof projectProfileProjectSchema>
export type ProjectProfileToolchain = z.infer<typeof projectProfileToolchainSchema>
export type ProjectProfileVerificationCommand = z.infer<typeof projectProfileVerificationCommandSchema>
export type ProjectProfile = z.infer<typeof projectProfileSchema>

export interface ProjectProfileClassificationInput {
  projectCount: number
  isMonorepo: boolean
}

/** Classifies discovered project roots without touching the filesystem. */
export function classifyProjectProfile(input: ProjectProfileClassificationInput): ProjectProfileClassification {
  if (!Number.isInteger(input.projectCount) || input.projectCount < 0) {
    throw new Error('projectCount must be a non-negative integer')
  }
  if (input.projectCount === 0) return 'empty'
  if (input.projectCount === 1) return 'existing'
  return input.isMonorepo ? 'monorepo' : 'multi-project'
}
