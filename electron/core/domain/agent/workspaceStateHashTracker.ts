import crypto from 'node:crypto'
import fs from 'node:fs'

export interface WorkspaceHashCheckResult {
  isStagnant: boolean
  previousStep?: number
  hash: string
}

/**
 * Tracks physical workspace file state changes via SHA-256 state hashing
 * to detect cyclic state oscillations ($S_1 \rightarrow S_2 \rightarrow S_1$).
 */
export class WorkspaceStateHashTracker {
  private stateHistory = new Map<string, number>()

  /**
   * Computes SHA-256 hash of a list of workspace file paths.
   */
  public computeStateHash(filePaths: string[]): string {
    const hasher = crypto.createHash('sha256')

    for (const filePath of filePaths.sort()) {
      try {
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath)
          hasher.update(`${filePath}:${stats.mtimeMs}:${stats.size}`)
        }
      } catch {}
    }

    return hasher.digest('hex')
  }

  /**
   * Records workspace state hash at current step and checks for stagnant state repetition.
   */
  public recordAndCheckState(step: number, affectedFiles: string[]): WorkspaceHashCheckResult {
    const hash = this.computeStateHash(affectedFiles)

    if (this.stateHistory.has(hash)) {
      const previousStep = this.stateHistory.get(hash)!
      return {
        isStagnant: true,
        previousStep,
        hash,
      }
    }

    this.stateHistory.set(hash, step)
    return { isStagnant: false, hash }
  }

  public reset(): void {
    this.stateHistory.clear()
  }
}
