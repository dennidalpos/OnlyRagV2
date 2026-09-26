import { renderAdviceSteps } from './diagnosticAdvice'

/** Package name -> the files that import it. The shape depcheck reports. */
export type MissingDependencyMap = Record<string, string[]>

export interface MissingDependency {
  packageName: string
  /** Workspace-relative paths, deduplicated and sorted for a stable directive. */
  importedBy: string[]
}

export interface DependencyIntegrityVerdict {
  ok: boolean
  missing: MissingDependency[]
  /** Present only when `ok` is false: what the model must do, in the loop's directive format. */
  directive?: string
}

/**
 * Type-only packages are a real declaration gap but never break a build at runtime, and
 * flagging them turns the gate into noise a small model then learns to ignore.
 */
function isTypesOnlyPackage(packageName: string): boolean {
  return packageName.startsWith('@types/')
}

function toWorkspaceRelative(filePath: string, workspacePath: string): string {
  const normalisedFile = filePath.replace(/\\/g, '/')
  const normalisedRoot = workspacePath.replace(/\\/g, '/').replace(/\/$/, '')
  return normalisedFile.startsWith(`${normalisedRoot}/`) ? normalisedFile.slice(normalisedRoot.length + 1) : normalisedFile
}

export function evaluateDependencyIntegrity(missingMap: MissingDependencyMap, workspacePath: string): DependencyIntegrityVerdict {
  const missing: MissingDependency[] = Object.entries(missingMap || {})
    .filter(([packageName]) => packageName && !isTypesOnlyPackage(packageName))
    .map(([packageName, files]) => ({
      packageName,
      importedBy: Array.from(new Set((files || []).map((f) => toWorkspaceRelative(f, workspacePath)))).sort(),
    }))
    .sort((a, b) => a.packageName.localeCompare(b.packageName))

  if (missing.length === 0) return { ok: true, missing: [] }

  const lines = missing.map((m, index) => `${index + 1}. "${m.packageName}" — imported by ${m.importedBy.join(', ')}`)

  return {
    ok: false,
    missing,
    directive: renderAdviceSteps(
      '[UNDECLARED DEPENDENCIES: THE PROJECT CANNOT BUILD]',
      [`The code imports ${missing.length} package${missing.length === 1 ? '' : 's'} that package.json does not declare:`, ...lines],
      [
        'Either add each package to the "dependencies" of package.json and re-run the install, or rewrite the importing files to use what the project already declares.',
        'Prefer rewriting when the import contradicts the requested stack — pulling in a second UI framework alongside the one you were asked to use is not a fix.',
        'Re-run the verification command afterwards: finish is accepted once it passes.',
      ],
    ),
  }
}
