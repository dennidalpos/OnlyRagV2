import type { ChildProcess } from 'node:child_process'
import { checkCommandSecurity } from '../domain/agent/commandSecurity'
import { sanitizePowerShellCommand } from '../domain/agent/shellStreamGuard'
import { parseTestRunOutput } from '../domain/agent/testResultParser'
import { DiagnosticOutputReducer } from '../domain/agent/diagnosticOutputReducer'
import { detectTestCommand } from '../domain/agent/tools/execution/testCommandDetection'
import type { ToolExecutionResult } from '../domain/agent/tools/toolExecutionContracts'
import { PersistentPowerShellSession } from '../infrastructure/process/persistentPowerShellSession'
import { agentToolFileRepository } from '../infrastructure/filesystem/agentToolFileRepository'
import { formatAgentTextIt } from '../../../shared/domain/agent/agentMainText'

type ShellSessionProvider = (workspacePath?: string | null) => PersistentPowerShellSession

/** Application adapter for the structured run_tests tool contract. */
export async function executeRunTestsTool(
  explicitCommand: string | undefined,
  workspacePath: string | null | undefined,
  getOrCreateShellSession: ShellSessionProvider,
  onTerminalOutput?: (data: string) => void,
  onProcessSpawned?: (proc: ChildProcess) => void,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  let execCmd = explicitCommand
  let detectionNote = ''
  if (!execCmd) {
    const cwd = workspacePath || process.cwd()
    const detected = detectTestCommand(
      cwd,
      (workspace) => agentToolFileRepository.readPackageJsonScripts(workspace),
      (workspace) => agentToolFileRepository.hasPytestConfig(workspace),
    )
    if (!detected) {
      const message = { key: 'toolTestsNoRunner' } as const
      return {
        outcome: 'blocked',
        outputForHistory:
          'No test command specified and no recognized test runner (package.json "test" script, or pytest.ini/pyproject.toml/setup.cfg) was found in the workspace. Provide an explicit "command" parameter.',
        logMessage: formatAgentTextIt(message),
        localized: { message },
        isTerminal: true,
      }
    }
    execCmd = detected.command
    detectionNote = ` (auto-detected: ${detected.source})`
  }

  const secCheck = checkCommandSecurity(execCmd, workspacePath)
  if (!secCheck.isAllowed || secCheck.requiresApproval) {
    const message = { key: 'toolTestsBlocked', params: { command: execCmd } } as const
    return {
      outcome: 'rejected',
      outputForHistory: `[SECURITY GUARDRAIL BLOCK]\nCommand: "${execCmd}"\nExecution FORBIDDEN by Security Policy: ${secCheck.blockedReason || 'Test commands must be read-only.'}`,
      logMessage: formatAgentTextIt(message),
      localized: { message },
      isTerminal: true,
    }
  }

  let sanitizedCmd = secCheck.sanitizedCommand
  if (process.platform === 'win32') {
    sanitizedCmd = sanitizePowerShellCommand(sanitizedCmd)
  }

  const TEST_TIMEOUT_MS = 180000

  try {
    const shell = getOrCreateShellSession(workspacePath)
    const res = await shell.execute(
      sanitizedCmd,
      (chunk) => {
        if (onTerminalOutput) onTerminalOutput(chunk.trim())
      },
      onProcessSpawned,
      TEST_TIMEOUT_MS,
      signal,
    )

    const rawOutput = DiagnosticOutputReducer.composeCommandOutput(res.stdout, res.stderr, res.code)
    const parsed = parseTestRunOutput(rawOutput, res.timedOut ? 1 : (res.code ?? 1))
    const statusLine = parsed.framework === 'unknown' ? parsed.summary : `${parsed.success ? '✅' : '❌'} ${parsed.summary}`

    const outputForHistory = res.timedOut
      ? `[TEST RUN TIMED OUT]\nCommand: "${sanitizedCmd}"${detectionNote}\nTest command exceeded ${TEST_TIMEOUT_MS / 1000}s and was terminated.\nPartial output:\n${DiagnosticOutputReducer.keepHeadAndTail(rawOutput, 3000)}`
      : `[TEST RUN RESULT]\nCommand: "${sanitizedCmd}"${detectionNote}\n${statusLine}\n\nOutput:\n${DiagnosticOutputReducer.keepHeadAndTail(rawOutput, 4000)}`

    const message: NonNullable<ToolExecutionResult['localized']>['message'] = res.timedOut
      ? { key: 'toolTestsTimedOut', params: { seconds: TEST_TIMEOUT_MS / 1000 } }
      : parsed.framework === 'unknown'
        ? parsed.success
          ? { key: 'toolTestsUnknownPassed' }
          : { key: 'toolTestsUnknownFailed', params: { code: res.code ?? 1 } }
        : parsed.success
          ? { key: 'toolTestsPassed', params: { passed: parsed.passed ?? 0, total: parsed.total ?? 0, framework: parsed.framework } }
          : {
              key: 'toolTestsFailed',
              params: { failed: parsed.failed ?? 0, passed: parsed.passed ?? 0, total: parsed.total ?? 0, framework: parsed.framework },
            }

    return {
      outcome: !res.timedOut && parsed.success ? 'success' : 'failure',
      outputForHistory,
      logMessage: formatAgentTextIt(message),
      localized: { message },
      logDetail: rawOutput.slice(0, 1000),
      isTerminal: true,
      verification: { ran: true, passed: !res.timedOut && parsed.success },
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const localizedMessage = { key: 'toolTestsException', params: { error: message } } as const
    return {
      outcome: 'failure',
      outputForHistory: `[TEST RUN ERROR]\nFailed executing test command "${sanitizedCmd}": ${message}`,
      logMessage: formatAgentTextIt(localizedMessage),
      localized: { message: localizedMessage },
      isTerminal: true,
    }
  }
}
