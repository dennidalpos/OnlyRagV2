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
  /** False when no scan could be performed, so callers do not read "no findings" as "healthy". */
  scanned: boolean
}

const NOT_SCANNED: DependencyScanResult = { missing: {}, scanned: false }

export async function scanWorkspaceDependencies(workspacePath: string | null | undefined, timeoutMs = 60_000): Promise<DependencyScanResult> {
  if (!workspacePath) return NOT_SCANNED
  const root = path.resolve(workspacePath)
  // No manifest means nothing declares dependencies, so nothing can be undeclared.
  if (!fs.existsSync(path.join(root, 'package.json'))) return NOT_SCANNED

  try {
    const scan = depcheck(root, { ignorePatterns: IGNORED, skipMissing: false })
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`depcheck timed out after ${timeoutMs} ms`)), timeoutMs))
    const result = await Promise.race([scan, timeout])
    return { missing: (result.missing || {}) as MissingDependencyMap, scanned: true }
  } catch (err: unknown) {
    // A scan that could not run must never be reported as a clean bill of health.
    logger.log('WARN', 'DependencyScanner', `Dependency scan failed for ${root}: ${errorMessage(err)}`)
    return NOT_SCANNED
  }
}
