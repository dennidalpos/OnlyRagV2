import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export interface FilesystemStateSnapshot {
  timestamp: number
  fileHashes: Map<string, string>
  combinedTreeHash: string
}

export interface VerificationRequirement {
  requireVerifiedBuild: boolean
  hasVerifiedBuild: boolean
  pendingMilestonesCount: number
  hasFileMutations: boolean
}

export interface ExecutionGuardCheckResult {
  allowed: boolean
  reason?: string
  suggestedAction?: string
}

/**
 * Enterprise Execution Guard providing:
 * 1. Transactional workspace state snapshots with cryptographic SHA-256 tree hashing.
 * 2. Strict Definition of Done (DoD) verification gating before task completion.
 * 3. State-drift and oscillation detection based on actual workspace contents.
 */
export class TransactionalExecutionGuard {
  private historySnapshots: FilesystemStateSnapshot[] = []
  private readonly workspaceRoot: string

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot)
  }

  /**
   * Computes SHA-256 hash of a single file content safely.
   */
  public hashFile(filePath: string): string | null {
    try {
      if (!fs.existsSync(filePath)) return null
      const st = fs.statSync(filePath)
      if (!st.isFile()) return null
      const content = fs.readFileSync(filePath)
      return crypto.createHash('sha256').update(content).digest('hex')
    } catch {
      return null
    }
  }

  /**
   * Captures a SHA-256 snapshot of specified key workspace files to detect state drift.
   */
  public captureWorkspaceSnapshot(targetFiles: string[]): FilesystemStateSnapshot {
    const fileHashes = new Map<string, string>()
    const hasher = crypto.createHash('sha256')

    const sortedFiles = Array.from(new Set(targetFiles)).sort()
    for (const relOrAbs of sortedFiles) {
      const absPath = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(this.workspaceRoot, relOrAbs)
      const h = this.hashFile(absPath) || 'DELETED'
      fileHashes.set(absPath, h)
      hasher.update(`${absPath}:${h}`)
    }

    const combinedTreeHash = hasher.digest('hex')
    const snapshot: FilesystemStateSnapshot = {
      timestamp: Date.now(),
      fileHashes,
      combinedTreeHash,
    }

    this.historySnapshots.push(snapshot)
    if (this.historySnapshots.length > 20) {
      this.historySnapshots.shift()
    }

    return snapshot
  }

  /**
   * Evaluates whether the workspace state has stagnated or oscillated back to a prior state.
   */
  public detectStateStagnation(currentSnapshot: FilesystemStateSnapshot): ExecutionGuardCheckResult {
    if (this.historySnapshots.length < 3) {
      return { allowed: true }
    }

    // Check for exact state oscillation (current tree hash matches a snapshot from 2+ steps ago)
    const priorMatchCount = this.historySnapshots.filter(
      (snap, idx) => idx < this.historySnapshots.length - 1 && snap.combinedTreeHash === currentSnapshot.combinedTreeHash
    ).length

    if (priorMatchCount >= 2) {
      return {
        allowed: false,
        reason: 'Workspace State Oscillation Detected',
        suggestedAction:
          '[CRITICAL SYSTEM GUARD: FILESYSTEM OSCILLATION DETECTED]\nYour recent file mutations restored the workspace to a previous state without solving the issue.\nDirectives:\n1. Stop reverting files to prior broken versions.\n2. Run a build/test verification command via run_command to get exact compiler/test errors.\n3. Analyze the error log before making further modifications.',
      }
    }

    return { allowed: true }
  }

  /**
   * Enforces Definition of Done (DoD) criteria prior to allowing the agent to complete the session.
   */
  public validateTaskCompletion(req: VerificationRequirement): ExecutionGuardCheckResult {
    if (req.pendingMilestonesCount > 0) {
      return {
        allowed: false,
        reason: `Unverified Milestones Remaining (${req.pendingMilestonesCount} remaining)`,
        suggestedAction: `[DEFINITION OF DONE VIOLATION: UNVERIFIED MILESTONES]\nYou cannot call finish while there are ${req.pendingMilestonesCount} unverified milestones in your execution plan.\nExecute verification commands and update milestone statuses to verified before finishing.`,
      }
    }

    if (req.hasFileMutations && req.requireVerifiedBuild && !req.hasVerifiedBuild) {
      return {
        allowed: false,
        reason: 'No Verified Build Execution',
        suggestedAction:
          '[DEFINITION OF DONE VIOLATION: MANDATORY VERIFICATION MISSING]\nYou have modified workspace files but have not run a verification command (e.g. npm run build, npm test, or tsc --noEmit).\nExecute a verification command via run_command to confirm zero regressions before calling finish.',
      }
    }

    return { allowed: true }
  }

  public reset(): void {
    this.historySnapshots = []
  }
}
