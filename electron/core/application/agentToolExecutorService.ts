import { workspaceAppService } from './workspaceAppService'
import { saveAgentCheckpoint } from '../infrastructure/filesystem/agentCheckpointStore'
import { FsToolService } from './fsToolService'
import { ProcessToolService } from './processToolService'
import { WebToolService } from './webToolService'
import { RecoveryToolService } from './recoveryToolService'
import { BrowserToolService } from './browserToolService'
import { VisualValidationRunner } from './visualValidationRunner'
import { visualValidationResultSchema } from '../domain/agent/visualValidationContracts'
import { DiagnosticsToolService } from './diagnosticsToolService'
import { GitToolService } from './gitToolService'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { electronDesktopShell } from '../infrastructure/electron/electronDesktopShell'
import { logger } from '../infrastructure/logging/logger'
import type { AgentToolCall, SupportedToolName } from '../domain/agent/agentTypes'
import { validatePathSafety } from '../domain/agent/contextFilter'
import { AtomicWorkspaceJournal, RollbackResult } from '../infrastructure/filesystem/atomicWorkspaceJournal'
import { contentVersion } from '../infrastructure/filesystem/fileContentVersion'
import { PersistentPowerShellSession } from '../infrastructure/process/persistentPowerShellSession'
import { FileSystemRepository } from '../infrastructure/filesystem/fileSystemRepository'
import { declaredDependencies, findVersionReality, buildVersionRealityDirective, type DeclaredDependency } from '../domain/agent/dependencyVersionReality'
import { buildVersionAnswer, versionQuestionPackages } from '../domain/agent/versionQuestion'
import { npmRegistryClient } from '../infrastructure/http/npmRegistryClient'
import { extractRequestedPackages } from '../domain/agent/installCommandParser'
import { evaluateFileImportIntegrity } from '../domain/agent/importDeclarationGate'
import {
  isBinaryInstalled,
  packageHasStyleEntry,
  readLocalModuleExports,
  readPackageExports,
  toWorkspaceRelativePath,
  readLocalModuleSource,
  readWorkspaceTextFile,
} from '../infrastructure/filesystem/packageExportScanner'
import { computeLineDiff, countDiffLines } from '../../../shared/domain/agent/diffEngine'
import { reconcileApprovedHunks } from '../domain/agent/tools/fs/hunkApproval'
import { documentIoRepository } from '../infrastructure/filesystem/documentIoRepository'
import { agentToolFileRepository } from '../infrastructure/filesystem/agentToolFileRepository'
import { gitCliRepository } from '../infrastructure/process/gitCliRepository'
import { devToolProbeRepository } from '../infrastructure/process/devToolProbeRepository'
import { buildSkillAdherenceRefusal, validateSkillAdherence } from '../domain/skills/skillAdherenceValidator'
import { workspaceTypecheckWorker } from '../infrastructure/process/workspaceTypecheckWorkerClient'
import { type DevToolStatus } from '../domain/agent/devToolchain'
import { probeToolchain } from '../domain/agent/tools/execution/devToolchainTools'
import type { AppSettings } from '../../../shared/types'
import { authorizeOfflineStrict } from '../domain/agent/offlineStrictPolicy'
import { authorizeLocalOnly } from '../domain/agent/localOnlyPolicy'
import { authorizeAndPersistNetworkApproved } from '../domain/agent/networkApprovedPolicy'
import { npxCommandNames } from '../domain/agent/offlineStrictPolicy'
import type { Capability, CapabilityConsent, CapabilityOperation } from '../domain/agent/capabilityPolicyContract'
import { CapabilityPolicyAuditRepository } from '../infrastructure/logging/capabilityPolicyAuditRepository'
import {
  findAlreadyInstalledPackages,
  isBlockingDevServerCommand,
  isLongRunningCommand,
  resolveCommandTimeoutMs,
} from '../domain/agent/tools/execution/commandPolicy'
import { toolExecutionResultSchema, type ClassifiedToolExecutionResult, type ToolExecutionResult } from '../domain/agent/tools/toolExecutionContracts'
import { validateWorkspaceRealpath } from '../infrastructure/filesystem/workspaceRealpathGuard'
import { formatAgentTextIt } from '../../../shared/domain/agent/agentMainText'
import { toolLog } from '../domain/agent/tools/toolExecutionContracts'
export type { ClassifiedToolExecutionResult, ToolExecutionResult } from '../domain/agent/tools/toolExecutionContracts'

export class AgentToolExecutorService {
  private repo = new FileSystemRepository()
  private journal = new AtomicWorkspaceJournal()
  private shellSessions = new Map<string, PersistentPowerShellSession>()
  private fsToolService: FsToolService
  private processToolService: ProcessToolService
  private webToolService: WebToolService
  private recoveryToolService: RecoveryToolService
  private browserToolService: BrowserToolService
  private visualValidationRunner: VisualValidationRunner
  private diagnosticsToolService: DiagnosticsToolService
  private gitToolService: GitToolService
  /** Packages whose registry facts have already been delivered; see versionRealityDirective. */
  private reportedVersionFacts = new Set<string>()

  constructor(
    private readonly policyAuditRepository = new CapabilityPolicyAuditRepository(),
    visualValidationRunner = new VisualValidationRunner(),
  ) {
    this.visualValidationRunner = visualValidationRunner
    this.fsToolService = new FsToolService({
      repository: workspaceAppService,
      readRepository: this.repo,
      symbolsRepository: this.repo,
      searchRepository: workspaceAppService,
      directoryRepository: agentToolFileRepository,
      journal: this.journal,
      readContent: (absolutePath) => this.readContentSafely(absolutePath),
      buildChangeStats: (filePath, before, after) => this.buildChangeStats(filePath, before, after),
      recursiveRepository: {
        exists: (absolutePath) => documentIoRepository.exists(absolutePath),
        listRecursive: (rootPath, maxDepth, ignoreDirs) => agentToolFileRepository.listRecursive(rootPath, maxDepth, ignoreDirs),
      },
      writeFileDependencies: {
        repository: this.repo,
        supportRepository: agentToolFileRepository,
        journal: this.journal,
        buildChangeStats: (filePath, before, after) => this.buildChangeStats(filePath, before, after),
        readContent: (absolutePath) => this.readContentSafely(absolutePath),
        importIntegrityDirective: (filePath, content, currentWorkspace) => this.importIntegrityDirective(filePath, content, currentWorkspace),
        versionRealityDirective: (filePath, content) => this.versionRealityDirective(filePath, content),
        incrementalTypecheck: async (currentWorkspace, filePath) => (await workspaceTypecheckWorker.checkWrittenFile(currentWorkspace, filePath)) || '',
        contentVersion,
      },
      checkWrittenFile: async (currentWorkspace, filePath) => (await workspaceTypecheckWorker.checkWrittenFile(currentWorkspace, filePath)) || '',
      replaceFile: {
        exists: (absolutePath) => documentIoRepository.exists(absolutePath),
        readIfExists: (absolutePath) => agentToolFileRepository.readIfExists(absolutePath),
        writeFileVersioned: (absolutePath, content, expectedHash, beforeWrite) =>
          this.repo.writeFileVersioned(absolutePath, content, expectedHash, beforeWrite),
      },
      multiReplaceFile: {
        readIfExists: (absolutePath) => agentToolFileRepository.readIfExists(absolutePath),
        writeFileVersioned: (absolutePath, content, expectedHash, beforeWrite) =>
          this.repo.writeFileVersioned(absolutePath, content, expectedHash, beforeWrite),
      },
      skillAdherence: (filePath, content, guidelines) => validateSkillAdherence(filePath, content, guidelines),
      buildSkillRefusal: (filePath, violation) => buildSkillAdherenceRefusal(filePath, violation),
      contentVersion,
    })
    this.processToolService = new ProcessToolService({
      getShellSession: (workspace) => this.getOrCreateShellSession(workspace),
      probeToolchain: () => this.probeToolchain(),
      readPackageJson: async (workspace) => {
        const result = await this.repo.readFile(path.join(workspace, 'package.json'))
        return result.success ? result.content || null : null
      },
      lookupPackages: (names) => npmRegistryClient.lookupAll(names),
      lookupPackage: (name) => npmRegistryClient.lookup(name),
      missingFromNodeModules: (workspace, packages) => agentToolFileRepository.missingFromNodeModules(workspace, packages),
    })
    this.webToolService = new WebToolService({ recordBeforeModification: (filePath) => this.journal.recordBeforeModification(filePath) })
    this.recoveryToolService = new RecoveryToolService(this.journal)
    this.browserToolService = new BrowserToolService({
      openExternal: (url) => electronDesktopShell.openExternal(url),
      openPath: (filePath) => electronDesktopShell.openPath(filePath),
      exists: (filePath) => documentIoRepository.exists(filePath),
    })
    this.diagnosticsToolService = new DiagnosticsToolService()
    this.gitToolService = new GitToolService({
      run: (directory, command, timeoutMs) => gitCliRepository.run(directory, command, timeoutMs),
      previewCommit: (directory, paths) => gitCliRepository.previewCommit(directory, paths),
      commit: (directory, message, paths, expectedDiffHash) => gitCliRepository.commit(directory, message, paths, expectedDiffHash),
      markCommitBoundary: () => {
        this.journal.commit()
      },
    })
  }

  /** The npx commands of `command` the workspace already provides, which npx runs without downloading. */
  static localNpxBinaries(command: string, workspacePath: string | null | undefined): string[] {
    return workspacePath ? npxCommandNames(command).filter((name) => isBinaryInstalled(workspacePath, name)) : []
  }

  private async policyBlock(
    parsedTool: AgentToolCall,
    workspacePath: string | null | undefined,
    settings: AppSettings,
    consent: CapabilityConsent,
    sessionId: string,
  ): Promise<ToolExecutionResult | null> {
    const networkTool = (
      {
        web_search: ['http-download', 'connect', parsedTool.parameters.query],
        fetch_web_content: ['http-download', 'connect', parsedTool.parameters.url],
        download_file: ['http-download', 'download', parsedTool.parameters.url],
        open_in_browser: ['browser', 'open', parsedTool.parameters.url || parsedTool.parameters.filePath || parsedTool.parameters.path],
        validate_visual_artifact: ['browser', 'open', parsedTool.parameters.artifactPath],
        run_command: ['shell', 'execute', parsedTool.parameters.command],
        ensure_tool: ['http-download', 'download', parsedTool.parameters.toolName || parsedTool.parameters.tool || parsedTool.parameters.name],
      } as Record<string, [Capability, CapabilityOperation, unknown]>
    )[parsedTool.tool]

    if (!networkTool) return null
    const [capability, operation, target] = networkTool
    const request = {
      sessionId,
      toolName: parsedTool.tool,
      capability,
      operation,
      mode: settings.capabilityPolicyMode,
      workspaceRoot: workspacePath || 'standalone',
      target: target ? String(target) : undefined,
      ...(capability === 'shell' ? { localBinaries: AgentToolExecutorService.localNpxBinaries(String(target || ''), workspacePath) } : {}),
      consent,
    } as const
    const policy =
      settings.capabilityPolicyMode === 'network-approved'
        ? await authorizeAndPersistNetworkApproved(request, this.policyAuditRepository)
        : settings.capabilityPolicyMode === 'local-only'
          ? authorizeLocalOnly(request)
          : authorizeOfflineStrict(request)
    if (policy.allowed) return null

    return {
      outcome: 'blocked',
      outputForHistory: `[POLICY BLOCK] ${policy.reason}`,
      ...toolLog('toolPolicyBlock', { tool: parsedTool.tool, reason: policy.reason }),
      isTerminal: true,
    }
  }

  public getJournal(): AtomicWorkspaceJournal {
    return this.journal
  }

  public rollbackJournal(): RollbackResult {
    return this.recoveryToolService.rollbackWorkspace()
  }

  /** Marks the end of the current agent step so its file changes become undoable via the rollback_last_step tool. */
  public endJournalStep(): void {
    this.journal.endStep()
  }

  public commitJournal(): number {
    return this.journal.commit()
  }

  /**
   * Ends the run's journal without undoing anything: the pre-run state of every file the run
   * changed is saved as a checkpoint the user can restore later. Returns its id, or null when the
   * run changed no file (or there is no workspace to hold it).
   */
  public checkpointJournal(workspacePath: string | null | undefined, runId: string): string | null {
    const checkpointId = workspacePath ? saveAgentCheckpoint(workspacePath, agentCheckpointId(runId), this.journal.sessionBaseline) : null
    this.journal.commit()
    return checkpointId
  }

  /** Stages and commits all changes in `cwd` via execFileSync (argv array, no shell) -- safe against injection via the commit message without needing to escape it for a shell string. */
  public previewGitCommit(cwd: string, observedPaths: readonly string[] = []) {
    return this.gitToolService.previewCommit(cwd, [...this.journal.trackedPaths, ...observedPaths])
  }

  private mutationPathBlock(parsedTool: AgentToolCall, workspacePath: string | null | undefined): ToolExecutionResult | null {
    const fields = (
      {
        write_file: ['filePath'],
        replace_file_content: ['filePath'],
        multi_replace_file_content: ['filePath'],
        delete_file: ['filePath'],
        create_directory: ['dirPath', 'filePath'],
        copy_file: ['sourcePath', 'filePath', 'targetPath', 'destination'],
        move_file: ['sourcePath', 'filePath', 'targetPath', 'destination'],
        download_file: ['filePath'],
        // Reads follow symlinks and junctions too: without the real-path check a junction inside
        // the workspace exposed any folder on the disk to read_file and grep_search.
        read_file: ['filePath'],
        get_file_info: ['filePath'],
        extract_code_symbols: ['filePath'],
        list_dir: ['dirPath'],
        list_files_recursive: ['dirPath'],
        grep_search: ['dirPath'],
      } as Record<string, string[]>
    )[parsedTool.tool]
    if (!fields) return null

    const root = workspacePath || process.cwd()
    for (const field of fields) {
      const value = parsedTool.parameters[field]
      if (typeof value !== 'string' || !value) continue
      const check = validateWorkspaceRealpath(value, root)
      if (!check.safePath) {
        return {
          outcome: 'rejected',
          outputForHistory: `Security Violation: ${check.error}`,
          ...toolLog('toolEditPathRejected', { tool: parsedTool.tool, error: String(check.error) }),
          isTerminal: true,
        }
      }
    }
    return null
  }

  public performGitCommit(
    cwd: string,
    commitMessage: string,
    paths: readonly string[],
    expectedDiffHash: string,
  ): { success: boolean; output: string; logMessage: string } {
    return this.gitToolService.commit(cwd, commitMessage, paths, expectedDiffHash)
  }

  /** Presence and version of allow-listed development tools. */
  public probeToolchain(): DevToolStatus[] {
    return probeToolchain((binary, versionArgs) => devToolProbeRepository.probeVersion(binary, versionArgs))
  }

  /** Current on-disk content, or '' when the file does not exist yet. */
  private readContentSafely(absolutePath: string): string {
    return agentToolFileRepository.readIfExists(absolutePath)
  }

  /** Line-level +/- size of a completed mutation for session metrics. */
  private buildChangeStats(filePath: string, before: string, after: string) {
    const { additions, deletions } = countDiffLines(computeLineDiff(before, after))
    return { filePath, additions, deletions }
  }

  /** Appended to a successful write when the file imports an undeclared package. */
  private importIntegrityDirective(filePath: string | undefined, content: string, workspacePath: string | null | undefined): string {
    if (!workspacePath) return ''
    const declared = agentToolFileRepository.readDeclaredPackages(workspacePath)
    if (!declared) return ''
    const verdict = evaluateFileImportIntegrity(String(filePath || ''), content, declared)
    if (verdict.ok || !verdict.directive) return ''
    logger.log('WARN', 'AgentToolExecutor', `[UNDECLARED_IMPORT] ${filePath} imports ${verdict.undeclared.join(', ')}`)
    return `\n\n${verdict.directive}`
  }

  /** Validates package.json against npm registry for invalid package versions. */
  private async versionRealityDirective(filePath: string | undefined, content: string): Promise<string> {
    if (!/(^|[\\/])package\.json$/i.test(String(filePath || ''))) return ''
    let manifest: unknown
    try {
      manifest = JSON.parse(content)
    } catch {
      return '' // Malformed JSON is the AST validator's business, not this check's.
    }
    const declared = declaredDependencies(manifest)
    if (declared.length === 0) return ''

    const facts = await npmRegistryClient.lookupAll(declared.map((d) => d.name))
    const findings = findVersionReality(declared, facts)

    // Report each package fact at most once per session to prevent infinite rewrite loops.
    findings.nonexistent = findings.nonexistent.filter((name) => !this.reportedVersionFacts.has(name))
    findings.unpublished = findings.unpublished.filter((item) => !this.reportedVersionFacts.has(item.name))
    findings.outdated = findings.outdated.filter((o) => !this.reportedVersionFacts.has(o.name))

    const directive = buildVersionRealityDirective(findings)
    if (!directive) return ''
    for (const name of [...findings.nonexistent, ...findings.unpublished.map((item) => item.name), ...findings.outdated.map((o) => o.name)]) {
      this.reportedVersionFacts.add(name)
    }
    logger.log('WARN', 'AgentToolExecutor', `[VERSION_REALITY] package.json declares versions the registry contradicts`)
    return directive
  }

  /** Registry-backed answer to a version question the model asked in AUTO mode (see versionQuestion.ts). */
  async answerVersionQuestion(question: string, workspacePath: string | null | undefined): Promise<string> {
    let declared: DeclaredDependency[] = []
    if (workspacePath) {
      const manifest = await this.repo.readFile(path.join(workspacePath, 'package.json'))
      try {
        declared = manifest.success && manifest.content ? declaredDependencies(JSON.parse(manifest.content)) : []
      } catch {
        declared = [] // Malformed JSON: the question is answered from the names it carries.
      }
    }
    const names = versionQuestionPackages(
      question,
      declared.map((dependency) => dependency.name),
    )
    const facts = names.length > 0 ? await npmRegistryClient.lookupAll(names) : []
    return buildVersionAnswer(facts, declared)
  }

  /** When the user approved only a subset of hunks in the PendingApprovalModal (instead of the whole proposal), rewrites the tool call into an equivalent write_file carrying just the approved hunks' effect, computed against the file's current on-disk content — the */
  public reconcileHunkApproval(parsedTool: AgentToolCall, approvedHunkIndices: number[] | undefined, workspacePath: string | null | undefined): AgentToolCall {
    if (!approvedHunkIndices) return parsedTool
    const filePath = parsedTool.parameters?.filePath
    const pathCheck = validatePathSafety(filePath, workspacePath)
    if (!pathCheck.safePath) return parsedTool // let the tool's own case surface the security error

    const beforeContent = this.readContentSafely(pathCheck.safePath)
    const reconciled = reconcileApprovedHunks(parsedTool, approvedHunkIndices, beforeContent)
    if (reconciled.tool !== 'write_file' || !agentToolFileRepository.getFileInfo(pathCheck.safePath)) return reconciled
    return {
      ...reconciled,
      parameters: { ...reconciled.parameters, expectedContentHash: contentVersion(beforeContent) },
    }
  }

  public getOrCreateShellSession(workspacePath?: string | null): PersistentPowerShellSession {
    const key = workspacePath || process.cwd()
    let session = this.shellSessions.get(key)
    if (!session || !session.isRunning) {
      session = new PersistentPowerShellSession(key)
      this.shellSessions.set(key, session)
    }
    return session
  }

  /** The agent shell's working directory for this workspace, when a shell is already running there. */
  public currentShellDirectory(workspacePath?: string | null): string | undefined {
    const session = this.shellSessions.get(workspacePath || process.cwd())
    return session?.isRunning ? session.currentDirectory : undefined
  }

  public disposeShellSessions(): void {
    for (const session of this.shellSessions.values()) {
      session.dispose()
    }
    this.shellSessions.clear()
  }

  async executeTool(
    parsedTool: AgentToolCall,
    workspacePath: string | null | undefined,
    settings: AppSettings,
    onTerminalOutput?: (data: string) => void,
    onProcessSpawned?: (proc: ChildProcess) => void,
    activeSkillGuidelines: string = '',
    signal?: AbortSignal,
    policyConsent: CapabilityConsent = { requested: false, granted: false },
    policySessionId: string = 'agent-execution',
    allowedToolsForTurn?: readonly SupportedToolName[],
    commandApprovalGranted = false,
  ): Promise<ClassifiedToolExecutionResult> {
    const result = await this.dispatchTool(
      parsedTool,
      workspacePath,
      settings,
      onTerminalOutput,
      onProcessSpawned,
      activeSkillGuidelines,
      signal,
      policyConsent,
      policySessionId,
      allowedToolsForTurn,
      commandApprovalGranted,
    )
    return toolExecutionResultSchema.parse(result)
  }

  private async dispatchTool(
    parsedTool: AgentToolCall,
    workspacePath: string | null | undefined,
    settings: AppSettings,
    onTerminalOutput?: (data: string) => void,
    onProcessSpawned?: (proc: ChildProcess) => void,
    activeSkillGuidelines: string = '',
    signal?: AbortSignal,
    policyConsent: CapabilityConsent = { requested: false, granted: false },
    policySessionId: string = 'agent-execution',
    allowedToolsForTurn?: readonly SupportedToolName[],
    commandApprovalGranted = false,
  ): Promise<ToolExecutionResult> {
    const { tool, parameters } = parsedTool

    if (allowedToolsForTurn && !allowedToolsForTurn.includes(tool)) {
      return {
        outcome: 'rejected',
        outputForHistory: `[TURN TOOL POLICY DENIED] Tool "${tool}" is not available for this phase.`,
        ...toolLog('toolTurnPolicyDenied', { tool }),
        isTerminal: true,
      }
    }

    const mutationPathBlock = this.mutationPathBlock(parsedTool, workspacePath)
    if (mutationPathBlock) return mutationPathBlock

    const policyBlock = await this.policyBlock(parsedTool, workspacePath, settings, policyConsent, policySessionId)
    if (policyBlock) return policyBlock

    switch (tool) {
      case 'read_file': {
        return this.fsToolService.executeReadFile(parameters, workspacePath)
      }

      case 'extract_code_symbols': {
        return this.fsToolService.executeExtractCodeSymbols(parameters, workspacePath)
      }

      case 'list_dir': {
        return this.fsToolService.executeListDirectory(parameters, workspacePath)
      }

      case 'inspect_os_env': {
        return this.processToolService.inspectOsEnvironment()
      }

      case 'ensure_tool': {
        return this.processToolService.executeEnsureTool(parameters, workspacePath, settings.allowTerminalExecution, signal, onTerminalOutput, onProcessSpawned)
      }

      case 'grep_search': {
        return this.fsToolService.executeGrepSearch(parameters, workspacePath)
      }

      case 'web_search': {
        return this.webToolService.executeSearch(parameters.query || '', parameters.maxResults || 8, signal)
      }

      case 'fetch_web_content': {
        return this.webToolService.executeFetch(parameters.url || '', signal)
      }

      case 'write_file': {
        return this.fsToolService.executeWriteFile(parameters, workspacePath, settings.allowFileModifications, activeSkillGuidelines)
      }

      case 'create_directory': {
        return this.fsToolService.executeCreateDirectory(parameters, workspacePath, settings.allowFileModifications)
      }

      case 'copy_file': {
        return this.fsToolService.executeCopyFile(parameters, workspacePath, settings.allowFileModifications)
      }

      case 'move_file': {
        return this.fsToolService.executeMoveFile(parameters, workspacePath, settings.allowFileModifications)
      }

      case 'list_files_recursive': {
        return this.fsToolService.executeListFilesRecursive(parameters, workspacePath)
      }

      case 'replace_file_content': {
        return this.fsToolService.executeReplaceFileContent(parameters, workspacePath, settings.allowFileModifications, activeSkillGuidelines)
      }

      case 'multi_replace_file_content': {
        return this.fsToolService.executeMultiReplaceFileContent(parameters, workspacePath, settings.allowFileModifications, activeSkillGuidelines)
      }

      case 'delete_file': {
        return this.fsToolService.executeDeleteFile(parameters, workspacePath, settings.allowFileModifications)
      }

      case 'download_file': {
        return this.webToolService.executeDownloadFile(parameters, workspacePath, settings.allowFileModifications, signal)
      }

      case 'run_command': {
        if (settings.allowTerminalExecution === false) {
          const message = { key: 'toolTerminalDisabled' } as const
          return {
            outcome: 'blocked',
            outputForHistory: 'Terminal command execution disabled in Settings.',
            logMessage: formatAgentTextIt(message),
            localized: { message },
            isTerminal: true,
          }
        }
        const cmd = parameters.command
        if (!cmd) {
          const message = { key: 'toolCommandMissing' } as const
          return {
            outcome: 'rejected',
            outputForHistory: 'Missing command parameter',
            logMessage: formatAgentTextIt(message),
            localized: { message },
            isTerminal: true,
          }
        }

        const installPreconditionFailure = await this.processToolService.validateInstallPreconditions(cmd, workspacePath)
        if (installPreconditionFailure) return installPreconditionFailure

        const preconditionFailure = this.processToolService.validateRunCommandPreconditions(cmd)
        if (preconditionFailure) return preconditionFailure

        const redundantInstall = await this.processToolService.validateRedundantInstall(cmd, workspacePath)
        if (redundantInstall) return redundantInstall

        const execution = await this.processToolService.executeRunCommand(
          cmd,
          workspacePath,
          parameters.timeoutSeconds,
          signal,
          onTerminalOutput,
          onProcessSpawned,
          commandApprovalGranted,
        )
        if (!('result' in execution)) return execution

        const { result: res, rawOutput, isCancelled, isFailure } = execution

        // Failure is determined by process exit code, not output scanning.
        if (isFailure) {
          const commonFailureDirectives = this.processToolService.buildCommonFailureDirectives(
            cmd,
            res,
            rawOutput,
            workspacePath,
            isCancelled,
            (workspace, fileName) => documentIoRepository.exists(path.join(workspace, fileName)),
          )
          // Classify failure diagnostics: peer conflicts, unpublished versions, module resolution.
          const failureDiagnostics = await this.processToolService.classifyFailureDiagnostics(rawOutput, workspacePath)
          const { resolutionConflictDirective, versionNotFoundDirective, moduleResolutionDirective, missingDepDirective } = failureDiagnostics
          const { npmNamingDirective, interactivePromptDirective } = this.processToolService.buildInteractionFailureDirectives(
            rawOutput,
            res.interruptedByPrompt,
          )
          // Specific directives take precedence over generic auto-healing tail.
          const specificDirectiveFired = Boolean(
            commonFailureDirectives ||
              resolutionConflictDirective ||
              versionNotFoundDirective ||
              missingDepDirective ||
              moduleResolutionDirective ||
              npmNamingDirective ||
              interactivePromptDirective,
          )
          const { deferredDiagnosticNote, healingTail } = this.processToolService.chooseAutoHealingDirective(
            rawOutput,
            specificDirectiveFired,
            (packageName) => (workspacePath ? readPackageExports(workspacePath, packageName) : []),
            (importingFile, specifier) => (workspacePath ? readLocalModuleExports(workspacePath, importingFile, specifier) : []),
            workspacePath
              ? {
                  packageHasStyleEntry: (packageName) => packageHasStyleEntry(workspacePath, packageName),
                  toWorkspaceRelative: (filePath) => toWorkspaceRelativePath(workspacePath, filePath),
                  fileExists: (relativePath) => agentToolFileRepository.getFileInfo(path.resolve(workspacePath, relativePath)) !== null,
                  binaryInstalled: (name) => isBinaryInstalled(workspacePath, name),
                  readWorkspaceFile: (relativePath) => readWorkspaceTextFile(workspacePath, relativePath),
                  readLocalModuleSource: (importingFile, specifier) => readLocalModuleSource(workspacePath, importingFile, specifier),
                }
              : {},
          )
          return this.processToolService.buildAutoHealingFailureResult(
            cmd,
            res,
            rawOutput,
            `${commonFailureDirectives}${resolutionConflictDirective}${versionNotFoundDirective}${missingDepDirective}${moduleResolutionDirective}${npmNamingDirective}${interactivePromptDirective}${deferredDiagnosticNote}`,
            healingTail,
          )
        }

        const message = { key: 'toolCommandFinished', params: { command: cmd } } as const
        return {
          outcome: 'success',
          outputForHistory: `Ran command: "${cmd}"\nOutput:\n${rawOutput}`,
          logMessage: formatAgentTextIt(message),
          localized: { message },
          logDetail: rawOutput.slice(0, 1000),
          isTerminal: true,
          effectOutcome: 'confirmed',
        }
      }

      case 'run_tests': {
        return this.processToolService.executeRunTests(
          parameters.command,
          workspacePath,
          settings.allowTerminalExecution,
          onTerminalOutput,
          onProcessSpawned,
          signal,
        )
      }

      case 'git_status': {
        return this.gitToolService.executeStatus(workspacePath)
      }

      case 'git_diff': {
        return this.gitToolService.executeDiff(parameters, workspacePath)
      }

      case 'git_commit': {
        return this.gitToolService.executeCommit(parameters, workspacePath)
      }

      case 'rollback_workspace': {
        return this.recoveryToolService.executeRollbackWorkspace()
      }

      case 'rollback_last_step': {
        return this.recoveryToolService.executeRollbackLastStep()
      }

      case 'get_file_info': {
        return this.fsToolService.executeFileInfo(parameters, workspacePath)
      }

      case 'open_in_browser': {
        return this.browserToolService.executeOpenInBrowser(parameters, workspacePath)
      }

      case 'validate_visual_artifact': {
        if (!workspacePath) {
          const result = visualValidationResultSchema.parse({
            status: 'UNAVAILABLE',
            screenshot: { status: 'unavailable' },
            dom: { status: 'unavailable' },
            console: [],
            http: [],
            redaction: { applied: false, fields: [] },
            error: 'Visual validation requires an active workspace.',
          })
          return {
            outcome: 'blocked',
            outputForHistory: JSON.stringify(result),
            ...toolLog('toolVisualUnavailable', { error: result.error || 'unknown' }),
            isTerminal: true,
          }
        }
        const outputDirectory = path.join(workspacePath, '.onlyrag', 'visual-validation')
        documentIoRepository.ensureDirectory(outputDirectory)
        const evidence = await this.visualValidationRunner.captureEvidence(parameters, workspacePath, outputDirectory, signal)
        const result =
          'status' in evidence && evidence.status === 'UNAVAILABLE'
            ? visualValidationResultSchema.parse({
                status: 'UNAVAILABLE',
                screenshot: { status: 'unavailable' },
                dom: { status: 'unavailable' },
                console: [],
                http: [],
                redaction: { applied: false, fields: [] },
                error: evidence.error,
              })
            : visualValidationResultSchema.parse({ status: 'verified', ...evidence })
        return {
          outcome: result.status === 'verified' ? 'success' : 'blocked',
          outputForHistory: JSON.stringify(result),
          ...toolLog('toolVisualDone', { status: result.status, target: String(parameters.artifactPath || 'artifact') }),
          logDetail: JSON.stringify(result).slice(0, 4000),
          isTerminal: true,
        }
      }

      case 'ask': {
        return this.diagnosticsToolService.executeAsk(parameters, parsedTool.explanation)
      }

      default:
        return {
          outcome: 'rejected',
          outputForHistory: `Unrecognized or unsupported tool: ${tool}`,
          ...toolLog('toolUnsupported', { tool: String(tool) }),
          isTerminal: true,
          terminalCode: 'MODEL_UNSUITABLE',
        }
    }
  }
}

export const agentToolExecutorService = new AgentToolExecutorService()

/** @internal Internals exposed for unit testing the command timeout policy. */
export const __testing = {
  resolveCommandTimeoutMs,
  isLongRunningCommand,
  isBlockingDevServerCommand,
  extractRequestedPackages,
  findAlreadyInstalledPackages,
}

/** A filesystem-safe, unique checkpoint name for one run. */
export function agentCheckpointId(runId: string): string {
  return `${runId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 50)}-${Date.now().toString(36)}`
}
