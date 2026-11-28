import fs from 'node:fs'
import path from 'node:path'
import { isPathWithinRoot } from '../../domain/agent/pathContainment'

export interface WorkspaceRealpathCheck {
  safePath: string | null
  error?: string
}

/** Rejects existing symlink or junction ancestors that resolve outside the workspace. */
export function validateWorkspaceRealpath(candidate: string, workspaceRoot: string): WorkspaceRealpathCheck {
  const root = path.resolve(workspaceRoot)
  const target = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate)
  if (!isPathWithinRoot(root, target)) {
    return { safePath: null, error: `Path '${candidate}' is outside workspace root '${workspaceRoot}'.` }
  }

  try {
    const realRoot = fs.realpathSync.native(root)
    let existingAncestor = target
    while (!fs.existsSync(existingAncestor)) {
      const parent = path.dirname(existingAncestor)
      if (parent === existingAncestor) return { safePath: null, error: `No existing workspace ancestor for '${candidate}'.` }
      existingAncestor = parent
    }
    const realAncestor = fs.realpathSync.native(existingAncestor)
    if (!isPathWithinRoot(realRoot, realAncestor)) {
      return { safePath: null, error: `Symlink or junction escape blocked for '${candidate}'.` }
    }
    return { safePath: target }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return { safePath: null, error: `Realpath validation failed: ${message}` }
  }
}
