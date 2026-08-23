/**
 * Runs the project's own verification and reports whether it passes.
 *
 * The command is resolved from the workspace manifest, never taken from the model: a plan that
 * says "Run `npm run build`" is a claim, not a capability, and in session-1787485700613-o3tx
 * three such milestones existed while no build ever ran.
 *
 * Dependencies are scanned before the command runs. A missing import fails the build anyway,
 * but with a message a small model routinely misreads ("Cannot find module") — naming the
 * undeclared packages and the files importing them turns it into something correctable.
 */

import { agentToolExecutorService } from './agentToolExecutorService'
import { checkCommandSecurity } from '../domain/agent/commandSecurity'
import { readWorkspaceManifest } from '../infrastructure/filesystem/workspaceManifestReader'
import { scanWorkspaceDependencies } from '../infrastructure/filesystem/dependencyScanner'
import { evaluateDependencyIntegrity } from '../domain/agent/dependencyIntegrityGate'
import { resolvePrimaryVerificationCommand } from '../domain/agent/projectVerificationResolver'

/** Long enough for a cold `npm run build` on a small project, short enough to not hang a turn. */
const VERIFICATION_TIMEOUT_MS = 180_000
const OUTPUT_TAIL_CHARS = 2000

export interface VerificationRunResult {
  /** False when the project offers no command capable of proving it works. */
  hasVerificationCommand: boolean
  /** Undefined when nothing could be run. */
  passed?: boolean
  command?: string
  /** Failure detail for the model: the dependency directive, or the command's output tail. */
  failureDetail?: string
}

export async function runProjectVerification(
  workspacePath: string | null,
  onOutput?: (chunk: string) => void
): Promise<VerificationRunResult> {
  if (!workspacePath) return { hasVerificationCommand: false }

  const manifest = readWorkspaceManifest(workspacePath)
  const verification = resolvePrimaryVerificationCommand(manifest)

  // Checked first: an undeclared import is a build failure whose cause is already known, and
  // saying which package and which file beats making the model infer it from a compiler error.
  const scan = await scanWorkspaceDependencies(workspacePath)
  if (scan.scanned) {
    const integrity = evaluateDependencyIntegrity(scan.missing, workspacePath)
    if (!integrity.ok) {
      return {
        hasVerificationCommand: true,
        passed: false,
        command: verification?.command ?? 'dependency integrity scan',
        failureDetail: integrity.directive,
      }
    }
  }

  if (!verification) return { hasVerificationCommand: false }

  const security = checkCommandSecurity(verification.command)
  if (!security.isAllowed) {
    return {
      hasVerificationCommand: true,
      passed: false,
      command: verification.command,
      failureDetail: `Verification command blocked by security policy: ${security.blockedReason}`,
    }
  }

  const shell = agentToolExecutorService.getOrCreateShellSession(workspacePath)
  const res = await shell.execute(
    security.sanitizedCommand,
    (chunk) => onOutput?.(chunk.trim()),
    undefined,
    VERIFICATION_TIMEOUT_MS
  )
  const passed = res.code === 0 && !res.timedOut

  return {
    hasVerificationCommand: true,
    passed,
    command: verification.command,
    failureDetail: passed
      ? undefined
      : `Command: ${verification.command} (from ${verification.source})\n` +
        `Exit code: ${res.code}${res.timedOut ? ' (timed out)' : ''}\n` +
        `${(res.stdout || res.stderr || '').trim().slice(-OUTPUT_TAIL_CHARS)}`,
  }
}
