import path from 'node:path'
import fs from 'node:fs'
import depcheck from 'depcheck'
import type { MissingDependencyMap } from '../../domain/agent/dependencyIntegrityGate'
import { logger } from '../logging/logger'
import { errorMessage } from '../../../../shared/domain/errors/errorMessage'

/** Directories that are never the agent's own source. */
const IGNORED = ['node_modules', 'dist', 'build', 'out', 'coverage', '.git', '.onlyrag']

export interface DependencyScanResult {
  /** Package -> importing files. Empty when the workspace has no manifest to check against. */
  missing: MissingDependencyMap
  peerProviders?: Record<string, string>
  /** False when no scan could be performed, so callers do not read "no findings" as "healthy". */
  scanned: boolean
}

const NOT_SCANNED: DependencyScanResult = { missing: {}, scanned: false }

export async function scanWorkspaceDependencies(workspacePath: string | null | undefined, timeoutMs = 60_000): Promise<DependencyScanResult> {
  if (!workspacePath) return NOT_SCANNED
  const root = path.resolve(workspacePath)
  // No manifest means nothing declares dependencies, so nothing can be undeclared.
  if (!fs.existsSync(path.join(root, 'package.json'))) return NOT_SCANNED

  let timeout: NodeJS.Timeout | undefined
  try {
    const scan = depcheck(root, { ignorePatterns: IGNORED, skipMissing: false })
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`depcheck timed out after ${timeoutMs} ms`)), timeoutMs)
    })
    const result = await Promise.race([scan, deadline])
    const invalidFiles = Object.keys(result.invalidFiles || {}).length
    const invalidDirectories = Object.keys(result.invalidDirs || {}).length
    if (invalidFiles || invalidDirectories) {
      throw new Error(`Dependency scan incomplete: ${invalidFiles} invalid file(s), ${invalidDirectories} inaccessible directory/directories`)
    }
    const missing = (result.missing || {}) as MissingDependencyMap
    const project = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const peerProviders: Record<string, string> = {}
    for (const provider of Object.keys({ ...project.dependencies, ...project.devDependencies })) {
      const manifestPath = path.join(root, 'node_modules', ...provider.split('/'), 'package.json')
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { peerDependencies?: Record<string, string> }
        for (const packageName of Object.keys(missing)) {
          if (manifest.peerDependencies?.[packageName]) peerProviders[packageName] = provider
        }
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') continue
        throw err
      }
    }
    return { missing, scanned: true, peerProviders }
  } catch (err: unknown) {
    // A scan that could not run must never be reported as a clean bill of health.
    logger.log('WARN', 'DependencyScanner', `Dependency scan failed for ${root}: ${errorMessage(err)}`)
    return NOT_SCANNED
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
