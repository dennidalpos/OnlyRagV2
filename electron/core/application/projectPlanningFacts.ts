import { discoverProjectProfile } from '../infrastructure/filesystem/projectProfileDiscovery'
import { generateCompactRepoMap } from '../infrastructure/filesystem/compactSemanticRepoMapper'
import { resolveProfileVerificationTargets } from '../domain/agent/projectProfileVerificationResolver'
import type { ProjectProfile } from '../domain/agent/projectProfileContract'
import { resolveGreenfieldScaffold } from '../domain/agent/greenfieldScaffoldResolver'
import type { WorkspaceScaffoldFacts } from '../../../shared/domain/agent/planCompilation'
import type { UserInterviewAnswer } from '../../../shared/types'

export interface ProjectPlanningFacts {
  workspace: 'unknown' | 'empty' | 'existing' | 'monorepo' | 'multi-project'
  hasFiles: boolean
  stack: {
    languages: string[]
    packageManagers: string[]
    testFrameworks: string[]
    buildTools: string[]
  }
  relevantFiles: string[]
  acceptedGreenfieldStack: string | null
  verification: {
    executableCommands: string[]
    proposedCommands: string[]
  }
  previousDecisions: Array<{ question: string; answer: string; provenance: string }>
}

export interface ProjectPlanningDiscovery {
  facts: ProjectPlanningFacts
  profile: ProjectProfile | null
  scaffold: WorkspaceScaffoldFacts
}

function relevantRepoFiles(repoMap: string, prompt: string, limit = 8): string[] {
  const tokens = Array.from(new Set((prompt.toLowerCase().match(/[a-z0-9_.-]{3,}/g) || [])))
  return repoMap
    .split(/\r?\n/)
    .map((line, index) => ({
      path: line.replace(/^📄\s*/, '').split(/\s+➔\s+/)[0].trim(),
      index,
      score: tokens.reduce((total, token) => total + (line.toLowerCase().includes(token) ? 1 : 0), 0),
    }))
    .filter((entry) => entry.path && entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.path)
}

/** Reads shared workspace facts once for interview and planning. */
export function collectProjectPlanningFacts(
  workspacePath: string | null | undefined,
  prompt: string,
  previousDecisions: readonly UserInterviewAnswer[] = []
): ProjectPlanningDiscovery {
  const profile = workspacePath ? discoverProjectProfile(workspacePath) : null
  const projects = profile?.projects || []
  const unique = (values: string[]) => [...new Set(values)].sort()
  const stack = {
    languages: unique(projects.flatMap((project) => project.toolchain.languages)),
    packageManagers: unique(projects.flatMap((project) => project.toolchain.packageManagers)),
    testFrameworks: unique(projects.flatMap((project) => project.toolchain.testFrameworks)),
    buildTools: unique(projects.flatMap((project) => project.toolchain.buildTools)),
  }
  const repoMap = workspacePath ? generateCompactRepoMap(workspacePath, 150) : ''
  const relevantFiles = relevantRepoFiles(repoMap, prompt)
  const workspace = profile?.classification || 'unknown'
  const hasFiles = repoMap.trim().length > 0
  const greenfield = resolveGreenfieldScaffold(workspace === 'empty' && !hasFiles, prompt, previousDecisions)
  const executableCommands = profile ? resolveProfileVerificationTargets(profile).map((target) => target.command) : []

  return {
    profile,
    scaffold: greenfield.scaffold,
    facts: {
      workspace,
      hasFiles,
      stack,
      relevantFiles,
      acceptedGreenfieldStack: greenfield.acceptedStack,
      verification: {
        executableCommands,
        proposedCommands: greenfield.proposedVerificationCommands,
      },
      previousDecisions: previousDecisions.map((decision) => ({
        question: decision.questionText,
        answer: decision.selectedOption,
        provenance: decision.provenance || 'unspecified',
      })),
    },
  }
}
