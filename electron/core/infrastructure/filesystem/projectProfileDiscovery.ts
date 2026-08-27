import fs from 'node:fs'
import path from 'node:path'
import {
  classifyProjectProfile,
  projectProfileSchema,
  type ProjectProfile,
  type ProjectProfileProject,
  type ProjectProfileToolchain,
} from '../../domain/agent/projectProfileContract'
import { resolveVerificationCommands } from '../../domain/agent/projectVerificationResolver'
import { readWorkspaceManifest } from './workspaceManifestReader'

const PROJECT_MANIFESTS = [
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
]
const LOCKFILES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'poetry.lock',
  'Pipfile.lock',
  'Cargo.lock',
  'composer.lock',
]
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.venv', 'out'])

function isDirectory(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isDirectory()
  } catch {
    return false
  }
}

function detectToolchain(rootPath: string, manifestFiles: string[]): ProjectProfileToolchain {
  const languages = new Set<string>()
  const packageManagers = new Set<string>()
  const testFrameworks = new Set<string>()
  const buildTools = new Set<string>()
  const declaredScripts = new Set<string>()

  if (manifestFiles.includes('package.json')) {
    languages.add('javascript')
    try {
      const packageJson = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'), 'utf-8')) as {
        packageManager?: string
        scripts?: Record<string, unknown>
        dependencies?: Record<string, unknown>
        devDependencies?: Record<string, unknown>
      }
      if (packageJson.packageManager?.startsWith('pnpm')) packageManagers.add('pnpm')
      else if (fs.existsSync(path.join(rootPath, 'pnpm-lock.yaml'))) packageManagers.add('pnpm')
      else if (fs.existsSync(path.join(rootPath, 'yarn.lock'))) packageManagers.add('yarn')
      else packageManagers.add('npm')
      for (const script of Object.keys(packageJson.scripts || {})) declaredScripts.add(script)
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
      if (deps.vitest || deps.jest || deps.mocha) testFrameworks.add(deps.vitest ? 'vitest' : deps.jest ? 'jest' : 'mocha')
      if (deps.vite) buildTools.add('vite')
      if (deps.webpack || deps['webpack-cli']) buildTools.add('webpack')
      if (deps.typescript || fs.existsSync(path.join(rootPath, 'tsconfig.json'))) {
        languages.delete('javascript')
        languages.add('typescript')
      }
    } catch {
      packageManagers.add('npm')
    }
  }
  if (manifestFiles.includes('requirements.txt') || manifestFiles.includes('pyproject.toml')) languages.add('python')
  if (manifestFiles.includes('Cargo.toml')) { languages.add('rust'); packageManagers.add('cargo') }
  if (manifestFiles.includes('go.mod')) { languages.add('go'); packageManagers.add('go') }
  if (manifestFiles.includes('pom.xml')) { languages.add('java'); packageManagers.add('maven') }
  if (manifestFiles.includes('build.gradle') || manifestFiles.includes('build.gradle.kts')) { languages.add('java'); packageManagers.add('gradle') }
  if (manifestFiles.includes('composer.json')) { languages.add('php'); packageManagers.add('composer') }

  return {
    languages: [...languages].sort(),
    packageManagers: [...packageManagers].sort(),
    testFrameworks: [...testFrameworks].sort(),
    buildTools: [...buildTools].sort(),
    declaredScripts: [...declaredScripts].sort(),
  }
}

function projectAt(rootPath: string, relativePath: string): ProjectProfileProject | null {
  const manifestFiles = PROJECT_MANIFESTS.filter((name) => fs.existsSync(path.join(rootPath, name)))
  if (manifestFiles.length === 0) return null
  const lockfiles = LOCKFILES.filter((name) => fs.existsSync(path.join(rootPath, name)))
  const id = relativePath === '.' ? 'root' : relativePath.replace(/[\\/]+/g, ':')
  return {
    id,
    relativePath,
    rootPath,
    manifestFiles,
    lockfiles,
    toolchain: detectToolchain(rootPath, manifestFiles),
    verificationCommands: resolveVerificationCommands(readWorkspaceManifest(rootPath)),
  }
}

/** Discovers the workspace root and its immediate project packages without running commands. */
export function discoverProjectProfile(workspacePath: string): ProjectProfile {
  const workspaceRoot = path.resolve(workspacePath)
  const projects: ProjectProfileProject[] = []
  const rootProject = projectAt(workspaceRoot, '.')
  if (rootProject) projects.push(rootProject)

  const scanDirectories = (currentRoot: string, relativeParent: string, depth: number) => {
    if (depth > 2 || !isDirectory(currentRoot)) return
    for (const entry of fs.readdirSync(currentRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue
      const relativePath = relativeParent ? `${relativeParent}/${entry.name}` : entry.name
      const absolutePath = path.join(currentRoot, entry.name)
      const project = projectAt(absolutePath, relativePath)
      if (project) projects.push(project)
      scanDirectories(absolutePath, relativePath, depth + 1)
    }
  }
  scanDirectories(workspaceRoot, '', 1)

  const rootPackage = rootProject && path.join(workspaceRoot, 'package.json')
  let isMonorepo = false
  if (rootPackage) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(rootPackage, 'utf-8')) as { workspaces?: unknown }
      isMonorepo = Array.isArray(packageJson.workspaces) || typeof packageJson.workspaces === 'object'
    } catch {
      isMonorepo = false
    }
  }
  isMonorepo ||= ['pnpm-workspace.yaml', 'lerna.json'].some((name) => fs.existsSync(path.join(workspaceRoot, name)))

  return projectProfileSchema.parse({
    schemaVersion: 1,
    workspaceRoot,
    classification: classifyProjectProfile({ projectCount: projects.length, isMonorepo }),
    projects,
  })
}
