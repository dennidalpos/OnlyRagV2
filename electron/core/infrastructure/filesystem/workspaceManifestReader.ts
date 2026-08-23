/**
 * Infrastructure adapter for the domain's `WorkspaceManifest` port
 * (see domain/agent/projectVerificationResolver.ts).
 *
 * Reads the workspace's own manifest so the verification commands come from the project rather
 * than from the model. A malformed package.json is reported as "no manifest" rather than
 * thrown: a project the agent has half-written is exactly the state this runs in, and the
 * caller's answer to "no manifest" — offer no build check — is already the safe one.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { WorkspaceManifest } from '../../domain/agent/projectVerificationResolver'
import { logger } from '../../../diagnostics'

const EMPTY: WorkspaceManifest = { packageJson: null, hasFile: () => false }

export function readWorkspaceManifest(workspacePath: string | null | undefined): WorkspaceManifest {
  if (!workspacePath) return EMPTY
  const root = path.resolve(workspacePath)
  if (!fs.existsSync(root)) return EMPTY

  let packageJson: WorkspaceManifest['packageJson'] = null
  const pkgPath = path.join(root, 'package.json')
  if (fs.existsSync(pkgPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      packageJson = parsed && typeof parsed === 'object' ? parsed : null
    } catch (err: any) {
      logger.log('WARN', 'WorkspaceManifest', `Unparseable package.json at ${pkgPath}: ${err.message}`)
    }
  }

  return {
    packageJson,
    hasFile: (relativePath: string) => {
      // Manifest probes are for fixed root-level filenames, but the guard costs nothing and
      // keeps a future caller from walking out of the workspace with a crafted path.
      const resolved = path.resolve(root, relativePath)
      const relativeToRoot = path.relative(root, resolved)
      if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) return false
      try {
        return fs.statSync(resolved).isFile()
      } catch {
        return false
      }
    },
  }
}
