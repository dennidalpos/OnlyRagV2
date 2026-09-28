import type { ProjectProfile, ProjectProfileVerificationCommand } from './projectProfileContract'
import { pickPrimaryVerification } from './projectVerificationResolver'

export interface ProjectProfileVerificationTarget extends ProjectProfileVerificationCommand {
  projectId: string
  projectRelativePath: string
  projectRootPath: string
}

/** Flattens the commands already observed in a profile without inventing project commands. */
export function resolveProfileVerificationTargets(profile: ProjectProfile): ProjectProfileVerificationTarget[] {
  return profile.projects.flatMap((project) =>
    project.verificationCommands.map((verification) => ({
      ...verification,
      projectId: project.id,
      projectRelativePath: project.relativePath,
      projectRootPath: project.rootPath,
    })),
  )
}

/** Picks one strongest check per project, so a multi-project workspace is never checked at one root only. */
export function resolvePrimaryProfileVerificationTargets(profile: ProjectProfile): ProjectProfileVerificationTarget[] {
  return profile.projects.flatMap((project) => {
    const verification = pickPrimaryVerification(project.verificationCommands)
    if (!verification) return []
    return [
      {
        ...verification,
        projectId: project.id,
        projectRelativePath: project.relativePath,
        projectRootPath: project.rootPath,
      },
    ]
  })
}

/** Runs typecheck as well as an entry-reachable build for TypeScript projects. */
export function resolveRequiredProfileVerificationTargets(profile: ProjectProfile): ProjectProfileVerificationTarget[] {
  return profile.projects.flatMap((project) => {
    const primary = pickPrimaryVerification(project.verificationCommands)
    if (!primary) return []
    const checks = [primary]
    const build = project.verificationCommands.find((command) => command.kind === 'build')
    if (project.toolchain.languages.includes('typescript') && build && build !== primary) checks.push(build)
    return checks.map((verification) => ({
      ...verification,
      projectId: project.id,
      projectRelativePath: project.relativePath,
      projectRootPath: project.rootPath,
    }))
  })
}
