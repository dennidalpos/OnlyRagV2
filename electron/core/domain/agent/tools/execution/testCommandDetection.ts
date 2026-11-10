export interface DetectedTestCommand {
  command: string
  source: string
}

export type PackageScriptReader = (workspacePath: string) => Readonly<Record<string, string>> | null
export type PytestConfigChecker = (workspacePath: string) => boolean

/** Selects the repository's canonical test command without reading the filesystem itself. */
export function detectTestCommand(
  workspacePath: string,
  readPackageJsonScripts: PackageScriptReader,
  hasPytestConfig: PytestConfigChecker,
): DetectedTestCommand | null {
  const scripts = readPackageJsonScripts(workspacePath)
  if (scripts?.['test:fast']) return { command: 'npm run test:fast', source: 'package.json scripts["test:fast"]' }
  if (scripts?.test) return { command: 'npm test', source: 'package.json scripts.test' }
  if (hasPytestConfig(workspacePath)) return { command: 'pytest -q', source: 'pytest config file detected' }
  return null
}
