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
import { discoverProjectProfile } from '../infrastructure/filesystem/projectProfileDiscovery'
import { scanWorkspaceDependencies } from '../infrastructure/filesystem/dependencyScanner'
import { evaluateDependencyIntegrity } from '../domain/agent/dependencyIntegrityGate'
import { resolvePrimaryProfileVerificationTargets } from '../domain/agent/projectProfileVerificationResolver'
import { classifyProjectVerification, type ProjectVerificationStatus } from '../domain/agent/projectVerificationStatus'

/** Long enough for a cold `npm run build` on a small project, short enough to not hang a turn. */
const VERIFICATION_TIMEOUT_MS = 180_000
const OUTPUT_TAIL_CHARS = 2000

export interface VerificationRunResult {
  /** False when the project offers no command capable of proving it works. */
  hasVerificationCommand: boolean
  /** Explicit evidence state; missing checks are never reported as verified. */
  status: ProjectVerificationStatus
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
  if (!workspacePath) return { hasVerificationCommand: false, status: 'unverifiable' }

  const profile = discoverProjectProfile(workspacePath)
  const verifications = resolvePrimaryProfileVerificationTargets(profile)
  const verificationLabel = verifications.map((target) => `${target.projectRelativePath}: ${target.command}`).join(' && ')

  // Checked first: an undeclared import is a build failure whose cause is already known, and
  // saying which package and which file beats making the model infer it from a compiler error.
  const scan = await scanWorkspaceDependencies(workspacePath)
  if (scan.scanned) {
    const integrity = evaluateDependencyIntegrity(scan.missing, workspacePath)
    if (!integrity.ok) {
      const result: VerificationRunResult = {
        hasVerificationCommand: true,
        passed: false,
        status: 'failed',
        command: verificationLabel || 'dependency integrity scan',
        failureDetail: integrity.directive,
      }
      return { ...result, status: classifyProjectVerification(result) }
    }
  }

  if (verifications.length === 0) return { hasVerificationCommand: false, status: 'unverifiable' }

  for (const verification of verifications) {
    const security = checkCommandSecurity(verification.command)
    if (!security.isAllowed) {
      const result: VerificationRunResult = {
        hasVerificationCommand: true,
        passed: false,
        status: 'failed',
        command: verificationLabel,
        failureDetail: `Verification command blocked for project ${verification.projectRelativePath}: ${security.blockedReason}`,
      }
      return { ...result, status: classifyProjectVerification(result) }
    }

    const shell = agentToolExecutorService.getOrCreateShellSession(verification.projectRootPath)
    const res = await shell.execute(
      security.sanitizedCommand,
      (chunk) => onOutput?.(chunk.trim()),
      undefined,
      VERIFICATION_TIMEOUT_MS
    )
    if (res.code !== 0 || res.timedOut) {
      const result: VerificationRunResult = {
        hasVerificationCommand: true,
        passed: false,
        status: 'failed',
        command: verificationLabel,
        failureDetail: `Project: ${verification.projectRelativePath}\nCommand: ${verification.command} (from ${verification.source})\n` +
          `Exit code: ${res.code}${res.timedOut ? ' (timed out)' : ''}\n` +
          `${(res.stdout || res.stderr || '').trim().slice(-OUTPUT_TAIL_CHARS)}`,
      }
      return { ...result, status: classifyProjectVerification(result) }
    }
  }

  return { hasVerificationCommand: true, passed: true, status: 'verified', command: verificationLabel }
}
