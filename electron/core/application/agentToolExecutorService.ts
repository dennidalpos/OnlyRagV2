import { workspaceAppService } from './workspaceAppService'
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
import fs from 'node:fs'
import type { ChildProcess } from 'node:child_process'
import { shell } from 'electron'
import { logger } from '../../diagnostics'
import type { AgentToolCall } from '../domain/agent/agentTypes'
import { validatePathSafety } from '../domain/agent/contextFilter'
import { AtomicWorkspaceJournal, RollbackResult } from '../infrastructure/filesystem/atomicWorkspaceJournal'
import { PersistentPowerShellSession } from '../infrastructure/process/persistentPowerShellSession'
import { FileSystemRepository } from '../infrastructure/filesystem/fileSystemRepository'
import { declaredDependencies, findVersionReality, buildVersionRealityDirective } from '../domain/agent/dependencyVersionReality'
import { npmRegistryClient } from '../infrastructure/http/npmRegistryClient'
import { extractRequestedPackages } from '../domain/agent/installCommandParser'
import { evaluateFileImportIntegrity } from '../domain/agent/importDeclarationGate'
import { readLocalModuleExports, readPackageExports } from '../infrastructure/filesystem/packageExportScanner'
import { computeLineDiff, countDiffLines } from '../../../shared/domain/agent/diffEngine'
import { reconcileApprovedHunks } from '../domain/agent/tools/fs/hunkApproval'
import { documentIoRepository } from '../infrastructure/filesystem/documentIoRepository'
import { agentToolFileRepository } from '../infrastructure/filesystem/agentToolFileRepository'
import { gitCliRepository } from '../infrastructure/process/gitCliRepository'
import { devToolProbeRepository } from '../infrastructure/process/devToolProbeRepository'
import { buildSkillAdherenceRefusal, validateSkillAdherence } from '../domain/skills/skillAdherenceValidator'
import { workspaceIncrementalTypecheck } from '../infrastructure/process/workspaceIncrementalTypecheck'
import { type DevToolStatus } from '../domain/agent/devToolchain'
import { probeToolchain } from '../domain/agent/tools/execution/devToolchainTools'
import type { AppSettings } from '../../../shared/types'
import { authorizeOfflineStrict } from '../domain/agent/offlineStrictPolicy'
import { authorizeLocalOnly } from '../domain/agent/localOnlyPolicy'
import { authorizeAndPersistNetworkApproved } from '../domain/agent/networkApprovedPolicy'
import type { Capability, CapabilityConsent, CapabilityOperation } from '../domain/agent/capabilityPolicyContract'
import { CapabilityPolicyAuditRepository } from '../infrastructure/logging/capabilityPolicyAuditRepository'
import {
  findAlreadyInstalledPackages,
  isBlockingDevServerCommand,
  isLongRunningCommand,
  resolveCommandTimeoutMs,
} from '../domain/agent/tools/execution/commandPolicy'
import type { ToolExecutionResult } from '../domain/agent/tools/toolExecutionContracts'
export type { ToolExecutionResult } from '../domain/agent/tools/toolExecutionContracts'

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
        incrementalTypecheck: (currentWorkspace, filePath) => workspaceIncrementalTypecheck.checkWrittenFile(currentWorkspace, filePath) || '',
      },
      replaceFile: {
        exists: (absolutePath) => documentIoRepository.exists(absolutePath),
        readIfExists: (absolutePath) => agentToolFileRepository.readIfExists(absolutePath),
        writeFile: (absolutePath, content) => this.repo.writeFile(absolutePath, content),
      },
      multiReplaceFile: {
        readIfExists: (absolutePath) => agentToolFileRepository.readIfExists(absolutePath),
        multiReplaceChunks: async (absolutePath, replacements) => {
          const result = await this.repo.multiReplaceChunks(absolutePath, replacements)
          return { ...result, replacedCount: result.replacedCount ?? 0 }
        },
      },
      skillAdherence: (filePath, content, guidelines) => validateSkillAdherence(filePath, content, guidelines),
      buildSkillRefusal: (filePath, violation) => buildSkillAdherenceRefusal(filePath, violation),
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
      openExternal: (url) => shell.openExternal(url),
      openPath: (filePath) => shell.openPath(filePath),
      exists: (filePath) => documentIoRepository.exists(filePath),
    })
    this.diagnosticsToolService = new DiagnosticsToolService()
    this.gitToolService = new GitToolService({
      run: (directory, command, timeoutMs) => gitCliRepository.run(directory, command, timeoutMs),
      commit: (directory, message) => gitCliRepository.commit(directory, message),
    })
  }

  private async policyBlock(
    parsedTool: AgentToolCall,
    workspacePath: string | null | undefined,
    settings: AppSettings,
    consent: CapabilityConsent,
    sessionId: string,
  ): Promise<ToolExecutionResult | null> {
    if (!settings.capabilityPolicyMode) return null

    const networkTool = ({
      web_search: ['http-download', 'connect', parsedTool.parameters.query],
      fetch_web_content: ['http-download', 'connect', parsedTool.parameters.url],
      download_file: ['http-download', 'download', parsedTool.parameters.url],
      open_in_browser: ['browser', 'open', parsedTool.parameters.url || parsedTool.parameters.filePath || parsedTool.parameters.path],
      validate_visual_artifact: ['browser', 'open', parsedTool.parameters.artifactPath],
      run_command: ['shell', 'execute', parsedTool.parameters.command],
      ensure_tool: ['http-download', 'download', parsedTool.parameters.toolName || parsedTool.parameters.tool || parsedTool.parameters.name],
    } as Record<string, [Capability, CapabilityOperation, unknown]>)[parsedTool.tool]

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
      consent,
    } as const
    const policy = settings.capabilityPolicyMode === 'network-approved'
      ? await authorizeAndPersistNetworkApproved(request, this.policyAuditRepository)
      : settings.capabilityPolicyMode === 'local-only'
        ? authorizeLocalOnly(request)
        : authorizeOfflineStrict(request)
    if (policy.allowed) return null

    return {
      outputForHistory: `[POLICY BLOCK] ${policy.reason}`,
      logMessage: `[POLICY BLOCK] ${parsedTool.tool}: ${policy.reason}`,
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
   * Stages and commits all changes in `cwd` via execFileSync (argv array, no shell) -- safe
   * against injection via the commit message without needing to escape it for a shell string.
   * Shared by the git_commit tool-call case below and by the workspace:git-commit IPC handler
   * (workspaceAppService.gitCommit), which is what the Coding Agent Studio approval flow actually
   * calls once the user approves a git_commit tool call -- see the Always-Confirm Gate in
   * agentOrchestratorAppService.ts.
   */
  public performGitCommit(cwd: string, commitMessage: string): { success: boolean; output: string; logMessage: string } {
    return this.gitToolService.commit(cwd, commitMessage)
  }

  /**
   * Probes one allow-listed tool by running its version command. A non-zero exit, a missing
   * binary, or a timeout all mean "not installed" — the caller only needs presence and version.
   */
  /** Presence and version of every allow-listed development tool. */
  public probeToolchain(): DevToolStatus[] {
    return probeToolchain((binary, versionArgs) => devToolProbeRepository.probeVersion(binary, versionArgs))
  }

  /** Current on-disk content, or '' when the file does not exist yet (a pure addition). */
  private readContentSafely(absolutePath: string): string {
    return agentToolFileRepository.readIfExists(absolutePath)
  }

  /** Line-level +/- size of a completed mutation, for the session change metrics. */
  private buildChangeStats(filePath: string, before: string, after: string) {
    const { additions, deletions } = countDiffLines(computeLineDiff(before, after))
    return { filePath, additions, deletions }
  }

  /**
   * Appended to a successful write when the file imports a package the project never declared.
   *
   * The write is NOT undone: the code is usually most of the way right and throwing it away
   * costs the model the turn that produced it. What it gets instead is the fact, immediately,
   * instead of a "Cannot find module" thirty steps later — or, as in
   * session-1787562597025-q8a5, never (see importDeclarationGate.ts).
   *
   * Returns '' whenever the gate has no confident opinion, so the ordinary write result is
   * untouched in every normal case.
   */
  private importIntegrityDirective(filePath: string | undefined, content: string, workspacePath: string | null | undefined): string {
    if (!workspacePath) return ''
    const declared = agentToolFileRepository.readDeclaredPackages(workspacePath)
    if (!declared) return ''
    const verdict = evaluateFileImportIntegrity(String(filePath || ''), content, declared)
    if (verdict.ok || !verdict.directive) return ''
    logger.log('WARN', 'AgentToolExecutor', `[UNDECLARED_IMPORT] ${filePath} imports ${verdict.undeclared.join(', ')}`)
    return `\n\n${verdict.directive}`
  }

  /**
   * The first install target the npm registry does not know, if any.
   *
   * Only explicit targets are considered: a bare `npm install` names none and legitimately
   * reinstalls from the lockfile. A registry that cannot be reached answers "exists", so a
   * dropped connection never turns into a refused install.
   */
  /**
   * The first install target that would take a declared dependency backwards past a major,
   * if any.
   *
   * Deliberately placed next to `firstNonexistentInstallTarget`, and called from the same spot:
   * both answer "is what this command names real for this project", one against the registry and
   * one against the manifest, and the registry facts the message quotes are already in the
   * client's per-session cache by the time this runs.
   *
   * This is the check `versionRealityDirective` cannot perform. That one is gated on
   * `write_file` of `package.json`, so `npm install react@^16.8.0` — which rewrites the same
   * file — walked past it three times in the `live-full-task` run of 2026-08-25T12:11 and pinned
   * the tree to `react@16.14.0`. See installVersionDowngrade.ts for the cascade that followed.
   *
   * Before execution rather than after, and the choice is not a preference. After the fact the
   * only evidence left is a diff of `package.json`, which costs a snapshot on every command and
   * still arrives too late: the manifest and `node_modules` are already repinned, and undoing
   * that needs a second install, i.e. a second imperative in the same message — the defect
   * §6.2.2 exists to prevent. Beforehand the command names `pkg@version` itself, so the verdict
   * is read straight off the text with nothing inferred, and refusing leaves the project exactly
   * as it was.
   */
  /** Registry-backed preflight for stale first installs and ranges that publish no version. */
  /**
   * Checks a freshly written `package.json` against the npm registry, and says so.
   *
   * The one thing a model with a knowledge cutoff structurally cannot get right on its own.
   * Across the live runs of 2026-08-25 it wrote `typescript@^4.7.3` (which could not parse the
   * `@types/node` npm installed alongside it, and took a run to 0/12), `vite@^4.0.0`,
   * `react@^18.2.0`, and two packages that do not exist on npm at all. The registry answers both
   * questions in one GET, so the fact arrives at the step that wrote the file rather than as an
   * unexplained `Cannot find module` twenty steps later.
   *
   * Only on `package.json`, and only when something is actually wrong: silence otherwise, so
   * the ordinary write result is untouched. A registry that cannot be reached says nothing —
   * "this package does not exist" must never be the way a dropped connection presents.
   */
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

    // Each package is reported once and then never again. Runs 14 and 15 of 2026-08-25 both
    // aborted early with `package.json` rewritten over and over: the check runs on every write,
    // so a range the model chose not to change produced the same directive at every turn. That
    // is the scale lesson already written in loopEscapePolicy.ts and toolRejectionEscalation.ts
    // — a directive that did not land the first time does not land on the ninth, it just costs
    // the steps. The fact has been delivered; what the model does with it is the plan's problem.
    findings.nonexistent = findings.nonexistent.filter((name) => !this.reportedVersionFacts.has(name))
    findings.outdated = findings.outdated.filter((o) => !this.reportedVersionFacts.has(o.name))

    const directive = buildVersionRealityDirective(findings)
    if (!directive) return ''
    for (const name of [...findings.nonexistent, ...findings.outdated.map((o) => o.name)]) {
      this.reportedVersionFacts.add(name)
    }
    logger.log('WARN', 'AgentToolExecutor', `[VERSION_REALITY] package.json declares versions the registry contradicts`)
    return directive
  }

  /**
   * When the user approved only a subset of hunks in the PendingApprovalModal (instead of the
   * whole proposal), rewrites the tool call into an equivalent write_file carrying just the
   * approved hunks' effect, computed against the file's current on-disk content — the same
   * projection (pendingChangeProjection.ts) and diff (diffEngine.ts) the modal itself used to
   * show the preview, so what gets written matches exactly what the user reviewed.
   *
   * Returns parsedTool unchanged when approvedHunkIndices is absent (the ordinary
   * all-or-nothing path), the tool isn't a file mutation, or every hunk was approved — a full
   * accept keeps the original tool's own semantics (e.g. delete_file stays a real delete
   * instead of becoming a write_file with empty content).
   */
  public reconcileHunkApproval(
    parsedTool: AgentToolCall,
    approvedHunkIndices: number[] | undefined,
    workspacePath: string | null | undefined
  ): AgentToolCall {
    if (!approvedHunkIndices) return parsedTool
    const filePath = parsedTool.parameters?.filePath
    const pathCheck = validatePathSafety(filePath, workspacePath)
    if (!pathCheck.safePath) return parsedTool // let the tool's own case surface the security error

    const beforeContent = this.readContentSafely(pathCheck.safePath)
    return reconcileApprovedHunks(parsedTool, approvedHunkIndices, beforeContent)
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
  ): Promise<ToolExecutionResult> {
    const { tool, parameters } = parsedTool

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
        return this.processToolService.executeEnsureTool(
          parameters,
          workspacePath,
          settings.allowTerminalExecution,
          signal,
          onTerminalOutput,
          onProcessSpawned,
        )
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
          return { outputForHistory: 'Terminal command execution disabled in Settings.', logMessage: 'Terminal command execution disabled in Settings.', isTerminal: true }
        }
        const cmd = parameters.command
        if (!cmd) {
          return { outputForHistory: 'Missing command parameter', logMessage: 'Missing command parameter', isTerminal: true }
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
        )
        if (!('result' in execution)) return execution

        const { result: res, rawOutput, isCancelled, isFailure } = execution

          // Failure is decided by the process's own exit status, not by scanning its output
          // for words like "Error:" or "FAIL" — those matched grep hits, verbose build logs and
          // passing test suites, sending successful commands into the auto-healing loop.
          // (persistentPowerShellSession combines $LASTEXITCODE with $? so pure-PowerShell
          // failures are reported too.) Cancellation is kept: an interactive generator that
          // aborts can still exit 0.
          if (isFailure) {
            const commonFailureDirectives = this.processToolService.buildCommonFailureDirectives(
              cmd,
              res,
              rawOutput,
              workspacePath,
              isCancelled,
              (workspace, fileName) => documentIoRepository.exists(path.join(workspace, fileName)),
            )
            // A peer-version conflict, parsed from npm's own report. Placed before the
            // missing-dependency branch because ERESOLVE output also mentions unresolved
            // packages, and "install the missing dependency" is the advice that just failed.
            const failureDiagnostics = await this.processToolService.classifyFailureDiagnostics(rawOutput, workspacePath)
            const { resolutionConflictDirective, versionNotFoundDirective, moduleResolutionDirective, missingDepDirective } = failureDiagnostics
            // ETARGET: a version that was never published. Its sibling ERESOLVE has been handled
            // since §5.3 and this case never was, so run 17 of 2026-08-25 repeated the same
            // refused install until the circuit breaker stopped the session. Placed after
            // ERESOLVE because that output can also mention versions, and a peer conflict is a
            // different fix.
            // "Cannot find module X" is two different failures wearing one message, and telling
            // them apart needs the disk, not the text: a package that is already in node_modules
            // cannot be installed into existence again. See moduleResolutionDiagnostic.ts for the
            // runs that spent their steps reinstalling packages that were already there.
            // `Cannot find module './api'` is not a missing dependency. `packageOfSpecifier` in
            // moduleResolutionDiagnostic.ts already knows this — "Relative imports belong to no
            // package" — but this gate matched the raw text instead of asking it, so a project
            // file that had not been written yet was diagnosed as an uninstalled package.
            //
            // Measured 2026-08-25T19:16, session live-full-task, step 34. `npm run build` reported
            // four errors: a TS2614 export/import mismatch carrying the compiler's own verbatim
            // fix, a TS2322, and two `Cannot find module` on './api' and './auth' — files the plan
            // had not created yet. This gate fired on the relative ones, which set
            // `specificDirectiveFired` and therefore suppressed buildDiagnosticFixDirective, so
            // the one directive that could name a file and a fix never reached the model. What
            // reached it was an order to install a package the text never names. The model
            // guessed `@mui/material`, the loop guard blocked it, and steps 35-50 were sixteen
            // consecutive blocked repeats of that guess until the step ceiling ended the run.
            //
            // The two non-tsc phrasings stay on the raw match: the `Cannot find module 'x'` regex
            // does not parse them, so requiring a resolved package name would silence genuine
            // bundler failures.
            // Naming them is the whole difference between an instruction and a riddle: the old
            // text shipped the literal placeholder `<package-name>` and left the model to invent
            // one. `unresolved` already holds the answer (§6.2.1).
            const { npmNamingDirective, interactivePromptDirective } = this.processToolService.buildInteractionFailureDirectives(rawOutput, res.interruptedByPrompt)
            // What the model is told to do about the failure, decided ONCE instead of stated
            // twice. The old tail said "apply the fix ... and re-run the command autonomously",
            // two imperatives in one sentence, and in the live run of 2026-08-24 the model did
            // the second: tsc named three files and lines at step 21 and the identical command
            // was re-run at steps 22-31 with nothing edited in between.
            //
            // When the compiler localised the error, the directive names that file and forbids
            // the re-run until something changes. When a more specific directive above already
            // fired (ERESOLVE, missing dependency, npm naming, interactive prompt), the tail
            // stops issuing an instruction of its own and defers to it.
            const specificDirectiveFired = Boolean(
              commonFailureDirectives || resolutionConflictDirective || versionNotFoundDirective ||
              missingDepDirective || moduleResolutionDirective || npmNamingDirective || interactivePromptDirective
            )
            const { deferredDiagnosticNote, healingTail } = this.processToolService.chooseAutoHealingDirective(
              rawOutput,
              specificDirectiveFired,
              (packageName) => workspacePath ? readPackageExports(workspacePath, packageName) : [],
              (importingFile, specifier) => workspacePath ? readLocalModuleExports(workspacePath, importingFile, specifier) : [],
            )
            return this.processToolService.buildAutoHealingFailureResult(
              cmd,
              res,
              rawOutput,
              `${commonFailureDirectives}${resolutionConflictDirective}${versionNotFoundDirective}${missingDepDirective}${moduleResolutionDirective}${npmNamingDirective}${interactivePromptDirective}${deferredDiagnosticNote}`,
              healingTail,
            )
          }

          return {
            outputForHistory: `Ran command: "${cmd}"\nOutput:\n${rawOutput}`,
            logMessage: `Terminal Command Finished: ${cmd}`,
            logDetail: rawOutput.slice(0, 1000),
            isTerminal: true,
          }
      }

      case 'run_tests': {
        return this.processToolService.executeRunTests(parameters.command, workspacePath, settings.allowTerminalExecution, onTerminalOutput, onProcessSpawned)
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
          return { outputForHistory: JSON.stringify(result), logMessage: result.error || 'Visual validation unavailable', isTerminal: true }
        }
        const outputDirectory = path.join(workspacePath, '.onlyrag', 'visual-validation')
        fs.mkdirSync(outputDirectory, { recursive: true })
        const evidence = await this.visualValidationRunner.captureEvidence(parameters, workspacePath, outputDirectory, signal)
        const result = 'status' in evidence && evidence.status === 'UNAVAILABLE'
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
          outputForHistory: JSON.stringify(result),
          logMessage: `Visual validation ${result.status}: ${parameters.artifactPath || 'artifact'}`,
          logDetail: JSON.stringify(result).slice(0, 4000),
          isTerminal: true,
        }
      }

      case 'ask': {
        return this.diagnosticsToolService.executeAsk(parameters, parsedTool.explanation)
      }

      default:
        return {
          outputForHistory: `Unrecognized or unsupported tool: ${tool}`,
          logMessage: `Unsupported tool ${tool}`,
          isTerminal: true,
          terminalCode: 'MODEL_UNSUITABLE',
        }
    }
  }
}

export const agentToolExecutorService = new AgentToolExecutorService()

/** Internals exposed for unit testing the command timeout policy. */
export const __testing = {
  resolveCommandTimeoutMs,
  isLongRunningCommand,
  isBlockingDevServerCommand,
  extractRequestedPackages,
  findAlreadyInstalledPackages,
}
