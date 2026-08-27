import type { ChildProcess } from 'node:child_process'
import { checkCommandSecurity } from '../domain/agent/commandSecurity'
import { sanitizePowerShellCommand } from '../domain/agent/shellStreamGuard'
import { isBlockingDevServerCommand, resolveCommandTimeoutMs } from '../domain/agent/tools/execution/commandPolicy'
import { DiagnosticOutputReducer } from '../domain/agent/diagnosticOutputReducer'
import type { PersistentPowerShellSession, ShellExecutionOutput } from '../infrastructure/process/persistentPowerShellSession'
import type { ToolExecutionResult } from '../domain/agent/tools/toolExecutionContracts'
import { formatToolchainInventory, type DevToolStatus } from '../domain/agent/devToolchain'
import os from 'node:os'
import type { AgentToolCall } from '../domain/agent/agentTypes'
import { DEV_TOOL_ALLOWLIST, buildInstallCommand, findToolDefinition, resolveInstallTarget } from '../domain/agent/devToolchain'
import { firstDowngradingInstallTarget, firstInvalidRegistryInstallTarget, firstNonexistentInstallTarget } from '../domain/agent/tools/execution/installCommandGuards'
import type { PackageFacts } from '../infrastructure/http/npmRegistryClient'
import { probeDevTool } from '../domain/agent/tools/execution/devToolchainTools'
import { devToolProbeRepository } from '../infrastructure/process/devToolProbeRepository'
import { INSTALL_COMMAND_TIMEOUT_MS } from '../domain/agent/tools/execution/commandPolicy'
import { logger } from '../../diagnostics'
import { executeRunTestsTool } from './runTestsTool'
import { extractRequestedPackages } from '../domain/agent/installCommandParser'
import { findAlreadyInstalledPackages } from '../domain/agent/tools/execution/commandPolicy'
import { npmResolutionDirectiveFor } from '../domain/agent/npmResolutionConflict'
import { buildVersionNotFoundDirective, parseVersionNotFound } from '../domain/agent/npmVersionNotFound'
import { buildModuleResolutionDirective, classifyModuleDiagnostic, unresolvedPackages } from '../domain/agent/moduleResolutionDiagnostic'
import { buildDiagnosticFixDirective, buildDeferredDiagnosticNote } from '../domain/agent/compilerDiagnosticDirective'

export interface RunCommandExecution {
  command: string
  result: ShellExecutionOutput
  rawOutput: string
  isCancelled: boolean
  isFailure: boolean
}

const TOOL_NAME_PREFIXES = [
  'write_file', 'read_file', 'replace_file_content', 'multi_replace_file_content',
  'delete_file', 'list_dir', 'list_files_recursive', 'grep_search',
  'extract_code_symbols', 'create_directory', 'copy_file', 'move_file',
  'web_search', 'fetch_web_content', 'download_file', 'inspect_os_env',
  'ask', 'finish',
]

interface ProcessToolDependencies {
  getShellSession(workspacePath: string | null | undefined): PersistentPowerShellSession
  probeToolchain?: () => DevToolStatus[]
  probeVersion?: (binary: string, versionArgs: string[]) => string | null
  platform?: NodeJS.Platform
  readPackageJson?: (workspacePath: string) => Promise<string | null>
  lookupPackages?: (names: string[]) => Promise<PackageFacts[]>
  lookupPackage?: (name: string) => Promise<PackageFacts>
  missingFromNodeModules?: (workspacePath: string, packages: string[]) => string[]
}

/** Application service for the guarded, cancellable execution boundary of run_command. */
export class ProcessToolService {
  constructor(private readonly dependencies: ProcessToolDependencies) {}

  validateRunCommandPreconditions(command: string): ToolExecutionResult | null {
    const confusedToolName = TOOL_NAME_PREFIXES.find((toolName) => command.trimStart().startsWith(toolName))
    if (confusedToolName) {
      const output = [
        `[TOOL_AS_SHELL_BLOCK]`,
        `Command: "${command}"`,
        `EXECUTION BLOCKED: "${confusedToolName}" is a structured tool, not a shell executable.`,
        `You MUST invoke it as a JSON tool call, not as a shell command.`,
        `Correct format:`,
        '```json',
        `{ "tool": "${confusedToolName}", "parameters": { ... }, "explanation": "..." }`,
        '```',
        `Do NOT pass tool names to run_command. Use the tool directly.`,
      ].join('\n')
      logger.log('WARN', 'ProcessToolService', `[TOOL_AS_SHELL_BLOCK] Model tried to run tool "${confusedToolName}" as shell command`)
      return { outputForHistory: output, logMessage: `[TOOL_AS_SHELL_BLOCK] Blocked shell execution of tool "${confusedToolName}"`, isTerminal: true }
    }

    if (isBlockingDevServerCommand(command)) {
      const output = [
        `[BLOCKING_DEV_SERVER_BLOCK]`,
        `Command: "${command}"`,
        `EXECUTION BLOCKED: this command starts a dev/watch server or otherwise never exits on its own.`,
        `run_command waits synchronously for the process to exit, so this would hang until the timeout is reached, wasting several minutes with no useful result.`,
        `Directives:`,
        `1. To verify the project builds correctly, use a one-shot command instead (e.g. "npm run build" or "tsc --noEmit").`,
        `2. Do NOT run dev servers, watch-mode test runners, or long-lived processes via run_command.`,
        `3. If you need the running app visually verified, tell the user it is ready to start manually -- do not attempt to launch it yourself.`,
      ].join('\n')
      logger.log('WARN', 'ProcessToolService', `[BLOCKING_DEV_SERVER_BLOCK] Blocked non-exiting command: "${command}"`)
      return { outputForHistory: output, logMessage: `[BLOCKING_DEV_SERVER_BLOCK] Blocked non-exiting command: "${command}"`, isTerminal: true }
    }

    return null
  }

  async validateInstallPreconditions(command: string, workspacePath: string | null | undefined): Promise<ToolExecutionResult | null> {
    if (!this.dependencies.lookupPackages) return null
    const unknownPackage = await firstNonexistentInstallTarget(command, this.dependencies.lookupPackages)
    if (unknownPackage) {
      const output = [
        `[PACKAGE DOES NOT EXIST — INSTALL NOT RUN]`,
        `The npm registry has no package named "${unknownPackage}". This command was not executed, because no flag makes an install of a non-existent package succeed.`,
        `Directives:`,
        `1. Do NOT run this install again, and do NOT add --force or --legacy-peer-deps.`,
        `2. If your code imports "${unknownPackage}", it is importing something that does not exist: use a real package, or write that code yourself.`,
      ].join('\n')
      return { outputForHistory: output, logMessage: `Install refused: ${unknownPackage} does not exist on npm`, isTerminal: true }
    }

    const packageJson = workspacePath && this.dependencies.readPackageJson ? await this.dependencies.readPackageJson(workspacePath) : null
    const invalidTarget = await firstInvalidRegistryInstallTarget(command, packageJson, this.dependencies.lookupPackages)
    if (invalidTarget) {
      logger.log('WARN', 'ProcessToolService', `[INSTALL_VERSION_REFUSED] ${command}`)
      return { outputForHistory: invalidTarget.refusal, logMessage: `Install refused: ${invalidTarget.name} has a ${invalidTarget.kind} requested version`, isTerminal: true }
    }

    if (!this.dependencies.lookupPackage) return null
    const downgrade = await firstDowngradingInstallTarget(command, packageJson, this.dependencies.lookupPackage)
    if (downgrade) {
      logger.log('WARN', 'ProcessToolService', `[VERSION_DOWNGRADE_REFUSED] ${command}`)
      return { outputForHistory: downgrade.refusal, logMessage: `Install refused: would downgrade ${downgrade.name} below the declared major`, isTerminal: true }
    }
    return null
  }

  async validateRedundantInstall(command: string, workspacePath: string | null | undefined): Promise<ToolExecutionResult | null> {
    if (!workspacePath || !this.dependencies.readPackageJson || !this.dependencies.missingFromNodeModules) return null
    const requested = extractRequestedPackages(command)
    const requestedPackages = requested.some((pkg) => pkg.hasExplicitVersion) ? [] : requested.map((pkg) => pkg.name)
    if (requestedPackages.length === 0) return null

    const packageJson = await this.dependencies.readPackageJson(workspacePath)
    const declared = packageJson ? findAlreadyInstalledPackages(requestedPackages, packageJson) : null
    const notOnDisk = declared ? this.dependencies.missingFromNodeModules(workspacePath, declared) : []
    if (declared && notOnDisk.length > 0) {
      logger.log('INFO', 'ProcessToolService', `[REDUNDANT_INSTALL_ALLOW] Declared but not in node_modules, install proceeds: ${notOnDisk.join(', ')}`)
    }
    if (!declared || notOnDisk.length > 0) return null

    const output = [
      `[REDUNDANT_INSTALL_SKIP]`,
      `Command: "${command}"`,
      `EXECUTION SKIPPED: every requested package (${declared.join(', ')}) is declared in package.json AND already present in node_modules.`,
      `Re-running this install would do nothing but waste time.`,
      `Directive: proceed with the next step of your plan -- this dependency is already installed.`,
    ].join('\n')
    logger.log('WARN', 'ProcessToolService', `[REDUNDANT_INSTALL_SKIP] Skipped already-installed packages: ${declared.join(', ')}`)
    return { outputForHistory: output, logMessage: `[REDUNDANT_INSTALL_SKIP] Skipped already-installed: ${declared.join(', ')}`, isTerminal: true }
  }

  buildCommonFailureDirectives(
    command: string,
    result: ShellExecutionOutput,
    rawOutput: string,
    workspacePath: string | null | undefined,
    isCancelled: boolean,
    workspaceFileExists: (workspacePath: string, fileName: string) => boolean,
  ): string {
    const lowerOutput = rawOutput.toLowerCase()
    const permissions = ['eperm', 'eacces', 'operation not permitted', 'permission denied'].some((marker) => lowerOutput.includes(marker))
      ? `\n\n[PERMISSIONS WARNING: EPERM DETECTED]\nCommand failed due to Windows file permission restrictions (EPERM / Access Denied). DO NOT attempt to write files or run npm install inside system-protected folders (Program Files). Move the project or work inside a user workspace directory (e.g. Desktop or Documents).`
      : ''
    const viteMissing = (lowerOutput.includes('0 modules transformed') || (lowerOutput.includes('vite') && result.code !== 0)) && workspacePath && !workspaceFileExists(workspacePath, 'index.html')
      ? `\n\n[VITE ENTRY POINT MISSING DIAGNOSTIC]\nVite build failed or transformed 0 modules because 'index.html' is missing in project root ('${workspacePath}'). Create 'index.html' (referencing '<script type="module" src="/src/main.tsx"></script>') and 'src/main.tsx' before re-running build.`
      : ''
    const createViteCancelled = (command.includes('create-vite') || command.includes('create vite') || command.includes('create-app')) && isCancelled
      ? `\n\n[VITE CLI NON-INTERACTIVE DIRECTIVE]\n'npm create vite' was cancelled because the target directory is not empty or requires interactive prompt selections. DO NOT re-run 'npm create vite' interactively.\nInstead, construct 'package.json', 'index.html', and 'src/main.tsx' directly using write_file, or run 'npx -y create-vite@latest . -- --template react-ts' after clearing conflicting files.`
      : ''
    return `${permissions}${viteMissing}${createViteCancelled}`
  }

  async classifyFailureDiagnostics(rawOutput: string, workspacePath: string | null | undefined): Promise<{
    resolutionConflictDirective: string
    versionNotFoundDirective: string
    unresolved: string[]
    moduleResolutionDirective: string
    missingDepDirective: string
  }> {
    const resolutionConflictDirective = npmResolutionDirectiveFor(rawOutput)
    const versionNotFound = resolutionConflictDirective ? null : parseVersionNotFound(rawOutput)
    const versionNotFoundDirective = versionNotFound && this.dependencies.lookupPackage
      ? buildVersionNotFoundDirective(versionNotFound, (await this.dependencies.lookupPackage(versionNotFound.packageName)).latest)
      : ''
    const unresolved = resolutionConflictDirective ? [] : unresolvedPackages(rawOutput)
    const moduleCause = workspacePath && unresolved.length > 0 && this.dependencies.missingFromNodeModules
      ? classifyModuleDiagnostic(rawOutput, (pkg) => this.dependencies.missingFromNodeModules!(workspacePath, [pkg]).length === 0)
      : 'none'
    const moduleResolutionDirective = moduleCause === 'compiler_resolution'
      ? buildModuleResolutionDirective(rawOutput, unresolved)
      : ''
    const lowerOutput = rawOutput.toLowerCase()
    const isMissingDependency = !resolutionConflictDirective && moduleCause !== 'compiler_resolution' &&
      ((lowerOutput.includes('cannot find module') && unresolved.length > 0) || lowerOutput.includes('module_not_found') || lowerOutput.includes('failed to resolve import'))
    const missingDepList = unresolved.slice(0, 5).map((pkg) => `"${pkg}"`).join(', ')
    const missingDepDirective = isMissingDependency
      ? `\n\n[MISSING DEPENDENCY DIAGNOSTIC]\nCompilation failed because ${missingDepList ? `${missingDepList} ${unresolved.length === 1 ? 'is' : 'are'} imported but not installed` : 'an imported module/package is missing'}.\nDirectives:\n1. Your next tool call MUST be "run_command" with: npm install ${missingDepList ? unresolved.slice(0, 5).join(' ') : '<the package named in the error above>'}\n2. Do NOT re-run the project check until that install has completed.`
      : ''
    return { resolutionConflictDirective, versionNotFoundDirective, unresolved, moduleResolutionDirective, missingDepDirective }
  }

  buildInteractionFailureDirectives(rawOutput: string, interruptedByPrompt?: boolean): {
    npmNamingDirective: string
    interactivePromptDirective: string
  } {
    const lowerOutput = rawOutput.toLowerCase()
    const npmNamingDirective = ['npm naming restrictions', 'can no longer contain capital letters', 'name can only contain url-friendly', 'name is invalid']
      .some((marker) => lowerOutput.includes(marker))
      ? `\n\n[NPM NAMING RESTRICTION DIRECTIVE]\nProject/package name is invalid because npm packages cannot contain uppercase letters or spaces. DO NOT repeat the command with capital letters. Either run with an all-lowercase name (e.g. 'project-dashboard-task') or construct the files directly using write_file (e.g. 'package.json', 'vite.config.ts', 'index.html', 'src/App.tsx').`
      : ''
    const interactivePromptDirective = interruptedByPrompt
      ? `\n\n[INTERACTIVE PROMPT DIRECTIVE]\nThe command was aborted because it requested interactive user input (e.g. a [y/n] confirmation or password prompt), which run_command cannot answer. Re-run using the tool's non-interactive flag (e.g. -y, --yes, --force, --batch) so it completes without prompting.`
      : ''
    return { npmNamingDirective, interactivePromptDirective }
  }

  buildAutoHealingFailureResult(
    command: string,
    result: ShellExecutionOutput,
    rawOutput: string,
    directives: string,
    healingTail: string,
  ): ToolExecutionResult {
    const output = `[TERMINAL AUTO-HEALING DIAGNOSTICS LOG]\nCommand: "${command}" (Exit Code: ${result.code}${result.timedOut ? ' - TIMED OUT' : ''}${result.interruptedByPrompt ? ' - INTERACTIVE PROMPT DETECTED' : ''})\nCaptured Error Stack Trace & Failure Output:\n\`\`\`\n${rawOutput.slice(0, 4000)}\n\`\`\`${directives}\n\n${healingTail}`
    return {
      outputForHistory: output,
      logMessage: 'Terminal Command Failed (Auto-Healing Diagnostic Captured)',
      logDetail: rawOutput.slice(0, 1000),
      isTerminal: true,
    }
  }

  chooseAutoHealingDirective(
    rawOutput: string,
    specificDirectiveFired: boolean,
    readPackageExports: (packageName: string) => string[],
    readLocalModuleExports: (importingFile: string, specifier: string) => string[],
  ): { deferredDiagnosticNote: string; healingTail: string } {
    const diagnosticDirective = specificDirectiveFired
      ? null
      : buildDiagnosticFixDirective(rawOutput, readPackageExports, readLocalModuleExports)
    const deferredDiagnosticNote = specificDirectiveFired ? buildDeferredDiagnosticNote(rawOutput) || '' : ''
    const healingTail = specificDirectiveFired
      ? 'DO NOT ask the user vague clarification questions: carry out the directive above.'
      : diagnosticDirective ||
        'AUTO-HEALING DIRECTIVE: The command above failed. DO NOT ask the user vague clarification questions, and do NOT re-run it unchanged — it will fail the same way. Read the output above, identify the one file or command parameter at fault, and fix that with write_file.'
    return { deferredDiagnosticNote, healingTail }
  }

  inspectOsEnvironment(): ToolExecutionResult {
    const hostLine = `Guest OS Environment: ${os.platform()} ${os.arch()} | CPUs: ${os.cpus().length} (${os.cpus()[0]?.model || ''}) | RAM Free: ${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)}GB`
    const output = `${hostLine}\n\n${formatToolchainInventory(this.dependencies.probeToolchain?.() || [])}`
    return {
      outputForHistory: output,
      logMessage: 'Guest OS Environment & Toolchain Inventory',
      logDetail: output,
    }
  }

  executeRunTests(
    command: string | undefined,
    workspacePath: string | null | undefined,
    allowTerminalExecution: boolean | undefined,
    onTerminalOutput: ((data: string) => void) | undefined,
    onProcessSpawned: ((proc: ChildProcess) => void) | undefined,
  ): Promise<ToolExecutionResult> {
    if (allowTerminalExecution === false) {
      return Promise.resolve({ outputForHistory: 'Terminal command execution disabled in Settings.', logMessage: 'Terminal command execution disabled in Settings.', isTerminal: true })
    }
    return executeRunTestsTool(command, workspacePath, (path) => this.dependencies.getShellSession(path), onTerminalOutput, onProcessSpawned)
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
