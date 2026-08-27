import type { ChildProcess } from 'node:child_process'
import { checkCommandSecurity } from '../domain/agent/commandSecurity'
import { sanitizePowerShellCommand } from '../domain/agent/shellStreamGuard'
import { resolveCommandTimeoutMs } from '../domain/agent/tools/execution/commandPolicy'
import { DiagnosticOutputReducer } from '../domain/agent/diagnosticOutputReducer'
import type { PersistentPowerShellSession, ShellExecutionOutput } from '../infrastructure/process/persistentPowerShellSession'
import type { ToolExecutionResult } from '../domain/agent/tools/toolExecutionContracts'
import { formatToolchainInventory, type DevToolStatus } from '../domain/agent/devToolchain'
import os from 'node:os'
import type { AgentToolCall } from '../domain/agent/agentTypes'
import { DEV_TOOL_ALLOWLIST, buildInstallCommand, findToolDefinition, resolveInstallTarget } from '../domain/agent/devToolchain'
import { probeDevTool } from '../domain/agent/tools/execution/devToolchainTools'
import { devToolProbeRepository } from '../infrastructure/process/devToolProbeRepository'
import { INSTALL_COMMAND_TIMEOUT_MS } from '../domain/agent/tools/execution/commandPolicy'
import { logger } from '../../diagnostics'

export interface RunCommandExecution {
  command: string
  result: ShellExecutionOutput
  rawOutput: string
  isCancelled: boolean
  isFailure: boolean
}

interface ProcessToolDependencies {
  getShellSession(workspacePath: string | null | undefined): PersistentPowerShellSession
  probeToolchain?: () => DevToolStatus[]
  probeVersion?: (binary: string, versionArgs: string[]) => string | null
  platform?: NodeJS.Platform
}

/** Application service for the guarded, cancellable execution boundary of run_command. */
export class ProcessToolService {
  constructor(private readonly dependencies: ProcessToolDependencies) {}

  inspectOsEnvironment(): ToolExecutionResult {
    const hostLine = `Guest OS Environment: ${os.platform()} ${os.arch()} | CPUs: ${os.cpus().length} (${os.cpus()[0]?.model || ''}) | RAM Free: ${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)}GB`
    const output = `${hostLine}\n\n${formatToolchainInventory(this.dependencies.probeToolchain?.() || [])}`
    return {
      outputForHistory: output,
      logMessage: 'Guest OS Environment & Toolchain Inventory',
      logDetail: output,
    }
  }

  async executeEnsureTool(
    parameters: AgentToolCall['parameters'],
    workspacePath: string | null | undefined,
    allowTerminalExecution: boolean | undefined,
    signal: AbortSignal | undefined,
    onTerminalOutput: ((data: string) => void) | undefined,
    onProcessSpawned: ((proc: ChildProcess) => void) | undefined,
  ): Promise<ToolExecutionResult> {
    const requested = String(parameters.toolName || parameters.tool || parameters.name || '').trim()
    const definition = findToolDefinition(requested)
    if (!definition) {
      const allowed = DEV_TOOL_ALLOWLIST.map((tool) => tool.id).join(', ')
      return {
        outputForHistory: `[ENSURE_TOOL REJECTED] '${requested || '(empty)'}' is not an installable development tool. Allowed: ${allowed}. Installing anything else is not permitted — ask the user instead.`,
        logMessage: `ensure_tool rejected: '${requested}' is not allow-listed`,
        isTerminal: true,
      }
    }

    const probeVersion = this.dependencies.probeVersion || ((binary, versionArgs) => devToolProbeRepository.probeVersion(binary, versionArgs))
    const status = probeDevTool(definition.id, probeVersion)
    if (status.installed) {
      return {
        outputForHistory: `${definition.displayName} is already installed (version ${status.version}). No installation performed.`,
        logMessage: `${definition.displayName} already present (${status.version})`,
        isTerminal: true,
      }
    }

    if (allowTerminalExecution === false) {
      return {
        outputForHistory: `${definition.displayName} is missing, but terminal execution is disabled in Settings so it cannot be installed. Ask the user to install it manually.`,
        logMessage: 'ensure_tool blocked: terminal execution disabled',
        isTerminal: true,
      }
    }

    const installTarget = resolveInstallTarget(definition.id)
    const installCmd = buildInstallCommand(definition.id)
    if (!installTarget || !installCmd) {
      return {
        outputForHistory: `[ENSURE_TOOL ERROR] No installation package is registered for '${definition.id}'.`,
        logMessage: `ensure_tool: no package for ${definition.id}`,
        isTerminal: true,
      }
    }

    if ((this.dependencies.platform || process.platform) !== 'win32') {
      return {
        outputForHistory: `[ENSURE_TOOL UNSUPPORTED] Automatic installation is only implemented for Windows (winget). Install ${definition.displayName} manually, then continue.`,
        logMessage: 'ensure_tool: unsupported platform',
        isTerminal: true,
      }
    }

    logger.log('INFO', 'ProcessToolService', `[ENSURE_TOOL] Installing ${installTarget.displayName} via winget (${installTarget.wingetId})`)
    try {
      const shell = this.dependencies.getShellSession(workspacePath)
      const result = await shell.execute(
        installCmd,
        (chunk) => onTerminalOutput?.(chunk.trim()),
        onProcessSpawned,
        INSTALL_COMMAND_TIMEOUT_MS,
        signal,
      )

      shell.refreshEnvironmentPath?.()
      const verified = probeDevTool(definition.id, probeVersion)
      if (verified.installed) {
        logger.log('INFO', 'ProcessToolService', `[ENSURE_TOOL] ${definition.displayName} installed: ${verified.version}`)
        return {
          outputForHistory: `Successfully installed ${installTarget.displayName}. ${definition.displayName} is now available (version ${verified.version}). PATH refreshed for this session.`,
          logMessage: `Installed ${installTarget.displayName} (${definition.id} ${verified.version})`,
          logDetail: installCmd,
          isTerminal: true,
        }
      }

      const rawOutput = DiagnosticOutputReducer.composeCommandOutput(result.stdout, result.stderr, result.code)
      return {
        outputForHistory: `[ENSURE_TOOL INSTALL FAILED]\nCommand: "${installCmd}"\n${definition.displayName} is still not detectable after installation.\nOutput:\n${rawOutput.slice(0, 2000)}\n\nDo not retry the same installation. Continue without this tool or ask the user to install it manually.`,
        logMessage: `ensure_tool: ${definition.displayName} still missing after install`,
        logDetail: rawOutput.slice(0, 1000),
        isTerminal: true,
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        outputForHistory: `[ENSURE_TOOL ERROR] Failed installing ${installTarget.displayName}: ${message}`,
        logMessage: `ensure_tool exception: ${message}`,
        isTerminal: true,
      }
    }
  }

  async executeRunCommand(
    command: string,
    workspacePath: string | null | undefined,
    timeoutSeconds: number | undefined,
    signal: AbortSignal | undefined,
    onTerminalOutput: ((data: string) => void) | undefined,
    onProcessSpawned: ((proc: ChildProcess) => void) | undefined,
  ): Promise<RunCommandExecution | ToolExecutionResult> {
    const security = checkCommandSecurity(command)
    if (!security.isAllowed) {
      const output = `[SECURITY GUARDRAIL BLOCK]\nCommand: "${command}"\nExecution FORBIDDEN by Security Policy: ${security.blockedReason}\nDirective: Refrain from executing dangerous commands.`
      return { outputForHistory: output, logMessage: `[SECURITY BLOCK] Forbidden command: "${command}"`, isTerminal: true }
    }

    let executableCommand = security.sanitizedCommand
    if (process.platform === 'win32') executableCommand = sanitizePowerShellCommand(executableCommand)
    const timeoutMs = resolveCommandTimeoutMs(command, timeoutSeconds)

    try {
      const result = await this.dependencies.getShellSession(workspacePath).execute(
        executableCommand,
        (chunk) => onTerminalOutput?.(chunk.trim()),
        onProcessSpawned,
        timeoutMs,
        signal,
      )
      const rawOutput = DiagnosticOutputReducer.composeCommandOutput(result.stdout, result.stderr, result.code)
      const lowerOutput = rawOutput.toLowerCase()
      const isCancelled = ['operation cancelled', 'operation canceled', 'user cancelled', 'user canceled', 'aborted']
        .some((marker) => lowerOutput.includes(marker))

      return {
        command,
        result,
        rawOutput,
        isCancelled,
        isFailure: result.code !== 0 || Boolean(result.timedOut) || isCancelled,
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const output = `[TERMINAL AUTO-HEALING DIAGNOSTICS LOG]\nFailed executing command "${command}": ${message}`
      return { outputForHistory: output, logMessage: `Terminal Execution Exception: ${message}`, isTerminal: true }
    }
  }
}
