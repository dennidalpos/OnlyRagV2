import path from 'node:path'
import { dependencyScanWorker } from '../process/dependencyScanWorkerClient'
import type { DependencyScanResult } from '../process/dependencyScanProtocol'
import { logger } from '../logging/logger'
import { errorMessage } from '../../../../shared/domain/errors/errorMessage'

export type { DependencyScanResult } from '../process/dependencyScanProtocol'

const NOT_SCANNED: DependencyScanResult = { missing: {}, scanned: false }

export async function scanWorkspaceDependencies(
  workspacePath: string | null | undefined,
  timeoutMs = 60_000,
  signal?: AbortSignal,
): Promise<DependencyScanResult> {
  if (!workspacePath || signal?.aborted) return NOT_SCANNED
  const root = path.resolve(workspacePath)
  try {
    return await dependencyScanWorker.scan(root, timeoutMs, signal)
  } catch (err: unknown) {
    // A scan that could not run must never be reported as a clean bill of health.
    logger.log('WARN', 'DependencyScanner', `Dependency scan failed for ${root}: ${errorMessage(err)}`)
    return NOT_SCANNED
  }
}
