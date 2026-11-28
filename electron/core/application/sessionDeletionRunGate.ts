import path from 'node:path'

function workspaceKey(workspacePath?: string | null): string {
  return workspacePath ? path.normalize(workspacePath).toLowerCase() : ''
}

/** Keeps an agent run and a deletion of its conversation mutually exclusive in Main. */
export class SessionDeletionRunGate {
  private readonly activeRuns = new Map<string, number>()
  private readonly activeWorkspaces = new Map<string, number>()
  private readonly deleting = new Set<string>()
  private readonly clearingWorkspaces = new Set<string>()

  beginRun(sessionId: string, workspacePath?: string | null): (() => void) | null {
    const workspace = workspaceKey(workspacePath)
    if (this.deleting.has(sessionId) || this.clearingWorkspaces.has(workspace)) return null
    this.activeRuns.set(sessionId, (this.activeRuns.get(sessionId) || 0) + 1)
    this.activeWorkspaces.set(workspace, (this.activeWorkspaces.get(workspace) || 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const remaining = (this.activeRuns.get(sessionId) || 1) - 1
      if (remaining === 0) this.activeRuns.delete(sessionId)
      else this.activeRuns.set(sessionId, remaining)
      const workspaceRemaining = (this.activeWorkspaces.get(workspace) || 1) - 1
      if (workspaceRemaining === 0) this.activeWorkspaces.delete(workspace)
      else this.activeWorkspaces.set(workspace, workspaceRemaining)
    }
  }

  reserveWorkspaceClear(workspacePath?: string | null): boolean {
    const workspace = workspaceKey(workspacePath)
    if (this.activeWorkspaces.has(workspace) || this.clearingWorkspaces.has(workspace)) return false
    this.clearingWorkspaces.add(workspace)
    return true
  }

  releaseWorkspaceClear(workspacePath?: string | null): void {
    this.clearingWorkspaces.delete(workspaceKey(workspacePath))
  }

  reserveDeletion(sessionIds: readonly string[]): boolean {
    if (sessionIds.some((id) => this.activeRuns.has(id))) return false
    for (const id of sessionIds) this.deleting.add(id)
    return true
  }

  releaseDeletion(sessionIds: readonly string[]): void {
    for (const id of sessionIds) this.deleting.delete(id)
  }
}

export const sessionDeletionRunGate = new SessionDeletionRunGate()
