import { workspaceAppService } from './workspaceAppService'
import { FsToolService } from './fsToolService'
import { ProcessToolService } from './processToolService'
import { WebToolService } from './webToolService'
import { RecoveryToolService } from './recoveryToolService'
import { BrowserToolService } from './browserToolService'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { shell } from 'electron'
import { logger } from '../../diagnostics'
import type { AgentToolCall } from '../domain/agent/agentTypes'
import { validatePathSafety } from '../domain/agent/contextFilter'
import { AtomicWorkspaceJournal, RollbackResult } from '../infrastructure/filesystem/atomicWorkspaceJournal'
import { PersistentPowerShellSession } from '../infrastructure/process/persistentPowerShellSession'
import { FileSystemRepository } from '../infrastructure/filesystem/fileSystemRepository'
import { webClient } from '../infrastructure/http/webClient'
import { declaredDependencies, findVersionReality, buildVersionRealityDirective } from '../domain/agent/dependencyVersionReality'
import { npmRegistryClient } from '../infrastructure/http/npmRegistryClient'
import { extractRequestedPackages } from '../domain/agent/installCommandParser'
import { evaluateFileImportIntegrity } from '../domain/agent/importDeclarationGate'
import { parseVersionNotFound, buildVersionNotFoundDirective } from '../domain/agent/npmVersionNotFound'
import {
  firstDowngradingInstallTarget,
  firstInvalidRegistryInstallTarget,
  firstNonexistentInstallTarget,
} from '../domain/agent/tools/execution/installCommandGuards'
import { buildDiagnosticFixDirective, buildDeferredDiagnosticNote } from '../domain/agent/compilerDiagnosticDirective'
import { readLocalModuleExports, readPackageExports } from '../infrastructure/filesystem/packageExportScanner'
import { classifyModuleDiagnostic, unresolvedPackages, buildModuleResolutionDirective } from '../domain/agent/moduleResolutionDiagnostic'
import { npmResolutionDirectiveFor } from '../domain/agent/npmResolutionConflict'
import { computeLineDiff, countDiffLines } from '../domain/agent/diffEngine'
import { reconcileApprovedHunks } from '../domain/agent/tools/fs/hunkApproval'
import { executeFileInfoTool } from '../domain/agent/tools/fs/fileInfoTool'
import { executeReadFileTool } from '../domain/agent/tools/fs/readFileTool'
import { executeExtractCodeSymbolsTool } from '../domain/agent/tools/fs/extractCodeSymbolsTool'
import { executeListDirectoryTool } from '../domain/agent/tools/fs/listDirectoryTool'
import { executeListFilesRecursiveTool } from '../domain/agent/tools/fs/listFilesRecursiveTool'
import { executeWriteFileTool } from '../domain/agent/tools/fs/writeFileTool'
import { executeReplaceFileContentTool } from '../domain/agent/tools/fs/replaceFileContentTool'
import { executeMultiReplaceFileContentTool } from '../domain/agent/tools/fs/multiReplaceFileContentTool'
import { executeGitDiff, executeGitStatus, performGitCommit } from '../domain/agent/tools/git/gitCommitTool'
import { executeWebContentFetch, executeWebSearch } from '../domain/agent/tools/web/webResearchTools'
import { documentIoRepository } from '../infrastructure/filesystem/documentIoRepository'
import { agentToolFileRepository } from '../infrastructure/filesystem/agentToolFileRepository'
import { gitCliRepository } from '../infrastructure/process/gitCliRepository'
import { devToolProbeRepository } from '../infrastructure/process/devToolProbeRepository'
import { buildSkillAdherenceRefusal, validateSkillAdherence } from '../domain/skills/skillAdherenceValidator'
import { workspaceIncrementalTypecheck } from '../infrastructure/process/workspaceIncrementalTypecheck'
import { type DevToolStatus } from '../domain/agent/devToolchain'
import { probeToolchain } from '../domain/agent/tools/execution/devToolchainTools'
import { executeRunTestsTool } from './runTestsTool'
import type { AppSettings } from '../../../src/types'
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
  /** Packages whose registry facts have already been delivered; see versionRealityDirective. */
  private reportedVersionFacts = new Set<string>()

  constructor(private readonly policyAuditRepository = new CapabilityPolicyAuditRepository()) {
    this.fsToolService = new FsToolService({
      repository: workspaceAppService,
      searchRepository: workspaceAppService,
      directoryRepository: agentToolFileRepository,
      journal: this.journal,
      readContent: (absolutePath) => this.readContentSafely(absolutePath),
      buildChangeStats: (filePath, before, after) => this.buildChangeStats(filePath, before, after),
    })
    this.processToolService = new ProcessToolService({
      getShellSession: (workspace) => this.getOrCreateShellSession(workspace),
      probeToolchain: () => this.probeToolchain(),
    })
    this.webToolService = new WebToolService({ recordBeforeModification: (filePath) => this.journal.recordBeforeModification(filePath) })
    this.recoveryToolService = new RecoveryToolService(this.journal)
    this.browserToolService = new BrowserToolService({
      openExternal: (url) => shell.openExternal(url),
      openPath: (filePath) => shell.openPath(filePath),
      exists: (filePath) => documentIoRepository.exists(filePath),
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
    return performGitCommit(cwd, commitMessage, (directory, message) => gitCliRepository.commit(directory, message))
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
        return executeReadFileTool(parameters, workspacePath, this.repo)
      }

      case 'extract_code_symbols': {
        return executeExtractCodeSymbolsTool(parameters, workspacePath, this.repo)
      }

      case 'list_dir': {
        return executeListDirectoryTool(parameters, workspacePath, agentToolFileRepository)
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
        const query = parameters.query || ''
        return executeWebSearch(query, parameters.maxResults || 8, (searchQuery, maxResults) => webClient.searchWeb(searchQuery, maxResults, signal))
      }

      case 'fetch_web_content': {
        const targetUrl = parameters.url || ''
        return executeWebContentFetch(targetUrl, (url) => webClient.fetchWebContent(url, 16000, signal))
      }

      case 'write_file': {
        if (settings.allowFileModifications === false) {
          return { outputForHistory: 'Direct file write disabled in Settings.', logMessage: 'File write disabled in settings' }
        }
        return executeWriteFileTool(
          parameters,
          workspacePath,
          activeSkillGuidelines,
          (filePath, content, guidelines) => validateSkillAdherence(filePath, content, guidelines),
          (filePath, violation) => buildSkillAdherenceRefusal(filePath, violation),
          {
            repository: this.repo,
            supportRepository: agentToolFileRepository,
            journal: this.journal,
            buildChangeStats: (filePath, before, after) => this.buildChangeStats(filePath, before, after),
            readContent: (absolutePath) => this.readContentSafely(absolutePath),
            importIntegrityDirective: (filePath, content, currentWorkspace) => this.importIntegrityDirective(filePath, content, currentWorkspace),
            versionRealityDirective: (filePath, content) => this.versionRealityDirective(filePath, content),
            incrementalTypecheck: (currentWorkspace, filePath) => workspaceIncrementalTypecheck.checkWrittenFile(currentWorkspace, filePath) || '',
          },
        )
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
        return executeListFilesRecursiveTool(parameters, workspacePath, {
          exists: (absolutePath) => documentIoRepository.exists(absolutePath),
          listRecursive: (rootPath, maxDepth, ignoreDirs) => agentToolFileRepository.listRecursive(rootPath, maxDepth, ignoreDirs),
        })
      }

      case 'replace_file_content': {
        if (settings.allowFileModifications === false) {
          return { outputForHistory: 'Direct file modification disabled in Settings.', logMessage: 'File modification disabled in settings' }
        }
        return executeReplaceFileContentTool(
          parameters,
          workspacePath,
          activeSkillGuidelines,
          (filePath, content, guidelines) => validateSkillAdherence(filePath, content, guidelines),
          (filePath, violation) => buildSkillAdherenceRefusal(filePath, violation),
          {
            exists: (absolutePath) => documentIoRepository.exists(absolutePath),
            readIfExists: (absolutePath) => agentToolFileRepository.readIfExists(absolutePath),
            writeFile: (absolutePath, content) => this.repo.writeFile(absolutePath, content),
          },
          this.journal,
          (filePath, before, after) => this.buildChangeStats(filePath, before, after),
        )
      }

      case 'multi_replace_file_content': {
        if (settings.allowFileModifications === false) {
          return { outputForHistory: 'Direct file modification disabled in Settings.', logMessage: 'File modification disabled in settings' }
        }
        return executeMultiReplaceFileContentTool(
          parameters,
          workspacePath,
          activeSkillGuidelines,
          (filePath, content, guidelines) => validateSkillAdherence(filePath, content, guidelines),
          (filePath, violation) => buildSkillAdherenceRefusal(filePath, violation),
          {
            readIfExists: (absolutePath) => agentToolFileRepository.readIfExists(absolutePath),
            multiReplaceChunks: async (absolutePath, replacements) => {
              const result = await this.repo.multiReplaceChunks(absolutePath, replacements)
              return { ...result, replacedCount: result.replacedCount ?? 0 }
            },
          },
          this.journal,
          (filePath, before, after) => this.buildChangeStats(filePath, before, after),
        )
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

        // An install of a package the registry has never heard of cannot succeed, so it is
        // refused before it spends a turn. Measured across 2026-08-25: `@tailwindcss/react` was
        // ordered six times in run 16 alone and thirteen times across the series, each attempt
        // costing a step and returning the same npm 404. The registry was already being asked
        // about `package.json`; asking about the command closes the other half.
        const unknownPackage = await firstNonexistentInstallTarget(cmd, (names) => npmRegistryClient.lookupAll(names))
        if (unknownPackage) {
          const refusal = [
            `[PACKAGE DOES NOT EXIST — INSTALL NOT RUN]`,
            `The npm registry has no package named "${unknownPackage}". This command was not executed, because no flag makes an install of a non-existent package succeed.`,
            `Directives:`,
            `1. Do NOT run this install again, and do NOT add --force or --legacy-peer-deps.`,
            `2. If your code imports "${unknownPackage}", it is importing something that does not exist: use a real package, or write that code yourself.`,
          ].join('\n')
          return { outputForHistory: refusal, logMessage: `Install refused: ${unknownPackage} does not exist on npm`, isTerminal: true }
        }

        // A package name can exist while the explicit version still cannot produce a sound new
        // dependency: either the range matches nothing (preflight ETARGET), or an undeclared
        // package is being introduced at an obsolete major copied from model training data.
        const packageJsonForRegistryGuard = workspacePath
          ? await this.repo.readFile(path.join(workspacePath, 'package.json'))
          : null
        const invalidRegistryTarget = await firstInvalidRegistryInstallTarget(
          cmd,
          packageJsonForRegistryGuard?.success ? packageJsonForRegistryGuard.content || null : null,
          (names) => npmRegistryClient.lookupAll(names),
        )
        if (invalidRegistryTarget) {
          logger.log('WARN', 'AgentToolExecutor', `[INSTALL_VERSION_REFUSED] ${cmd}`)
          return {
            outputForHistory: invalidRegistryTarget.refusal,
            logMessage: `Install refused: ${invalidRegistryTarget.name} has a ${invalidRegistryTarget.kind} requested version`,
            isTerminal: true,
          }
        }

        // The same reality check, against the manifest instead of the registry: an install that
        // moves a declared dependency backwards past a major is refused before it can rewrite
        // package.json. `versionRealityDirective` below only sees `write_file`, so until this
        // guard existed a version installed by command was compared against nothing at all --
        // three successful `npm install react@^16.8.0` in the run of 2026-08-25T12:11, on a
        // project declaring `^18.2.0`, and the ERESOLVE cascade that followed.
        const packageJsonForDowngradeGuard = workspacePath
          ? await this.repo.readFile(path.join(workspacePath, 'package.json'))
          : null
        const downgrade = await firstDowngradingInstallTarget(
          cmd,
          packageJsonForDowngradeGuard?.success ? packageJsonForDowngradeGuard.content || null : null,
          (name) => npmRegistryClient.lookup(name),
        )
        if (downgrade) {
          logger.log('WARN', 'AgentToolExecutor', `[VERSION_DOWNGRADE_REFUSED] ${cmd}`)
          return {
            outputForHistory: downgrade.refusal,
            logMessage: `Install refused: would downgrade ${downgrade.name} below the declared major`,
            isTerminal: true,
          }
        }

        // Shell-Tool Confusion Guard: detect when the model passes a registered
        // tool name as a shell command (e.g. write_file "path" "content").
        // This causes guaranteed timeouts since tool names are not OS executables.
        const TOOL_NAME_PREFIXES = [
          'write_file', 'read_file', 'replace_file_content', 'multi_replace_file_content',
          'delete_file', 'list_dir', 'list_files_recursive', 'grep_search',
          'extract_code_symbols', 'create_directory', 'copy_file', 'move_file',
          'web_search', 'fetch_web_content', 'download_file', 'inspect_os_env',
          'ask', 'finish',
        ]
        const cmdTrimmed = cmd.trimStart()
        const confusedToolName = TOOL_NAME_PREFIXES.find((t) => cmdTrimmed.startsWith(t))
        if (confusedToolName) {
          const guardFeedback = [
            `[TOOL_AS_SHELL_BLOCK]`,
            `Command: "${cmd}"`,
            `EXECUTION BLOCKED: "${confusedToolName}" is a structured tool, not a shell executable.`,
            `You MUST invoke it as a JSON tool call, not as a shell command.`,
            `Correct format:`,
            `\`\`\`json`,
            `{ "tool": "${confusedToolName}", "parameters": { ... }, "explanation": "..." }`,
            `\`\`\``,
            `Do NOT pass tool names to run_command. Use the tool directly.`,
          ].join('\n')
          logger.log('WARN', 'AgentToolExecutor', `[TOOL_AS_SHELL_BLOCK] Model tried to run tool "${confusedToolName}" as shell command`)
          return { outputForHistory: guardFeedback, logMessage: `[TOOL_AS_SHELL_BLOCK] Blocked shell execution of tool "${confusedToolName}"`, isTerminal: true }
        }

        // Blocking Dev-Server Guard: run_command waits synchronously for the process to exit,
        // but a dev/watch server never exits on its own -- executing one here always burns the
        // full command timeout (up to 10 minutes) for no useful signal.
        if (isBlockingDevServerCommand(cmd)) {
          const guardFeedback = [
            `[BLOCKING_DEV_SERVER_BLOCK]`,
            `Command: "${cmd}"`,
            `EXECUTION BLOCKED: this command starts a dev/watch server or otherwise never exits on its own.`,
            `run_command waits synchronously for the process to exit, so this would hang until the timeout is reached, wasting several minutes with no useful result.`,
            `Directives:`,
            `1. To verify the project builds correctly, use a one-shot command instead (e.g. "npm run build" or "tsc --noEmit").`,
            `2. Do NOT run dev servers, watch-mode test runners, or long-lived processes via run_command.`,
            `3. If you need the running app visually verified, tell the user it is ready to start manually -- do not attempt to launch it yourself.`,
          ].join('\n')
          logger.log('WARN', 'AgentToolExecutor', `[BLOCKING_DEV_SERVER_BLOCK] Blocked non-exiting command: "${cmd}"`)
          return { outputForHistory: guardFeedback, logMessage: `[BLOCKING_DEV_SERVER_BLOCK] Blocked non-exiting command: "${cmd}"`, isTerminal: true }
        }

        // Redundant Install Guard: skip an install command whose every named package is already
        // declared in package.json AND present in node_modules -- only then is it a costly
        // no-op. Any doubt (package.json missing/unreadable, only some packages declared, or
        // anything absent from node_modules) lets the command through as before.
        //
        // Both halves are required. Declaration alone was the original test, and it inverted
        // the guard's purpose the moment the agent authored package.json itself: everything
        // reads as installed while node_modules does not exist, so the guard blocks the install
        // that would make the project buildable instead of a pointless repeat of one.
        if (workspacePath) {
          const requested = extractRequestedPackages(cmd)
          // A command naming an explicit version is a request to CHANGE the version, not to
          // reinstall what is there. Skipping it silently defeats the one fix that resolves a
          // peer conflict: `npm install vite@^8` would be answered "vite is already installed"
          // by a guard that only ever compares names (observed in the ERESOLVE probe).
          const requestsVersionChange = requested.some((pkg) => pkg.hasExplicitVersion)
          const requestedPkgs = requestsVersionChange ? [] : requested.map((pkg) => pkg.name)
          if (requestedPkgs.length > 0) {
            const pkgJsonRes = await this.repo.readFile(path.join(workspacePath, 'package.json'))
            const declared = pkgJsonRes.success && pkgJsonRes.content
              ? findAlreadyInstalledPackages(requestedPkgs, pkgJsonRes.content)
              : null
            const notOnDisk = declared ? agentToolFileRepository.missingFromNodeModules(workspacePath, declared) : []
            if (declared && notOnDisk.length > 0) {
              logger.log(
                'INFO',
                'AgentToolExecutor',
                `[REDUNDANT_INSTALL_ALLOW] Declared but not in node_modules, install proceeds: ${notOnDisk.join(', ')}`
              )
            }
            const alreadyInstalled = declared && notOnDisk.length === 0 ? declared : null
            if (alreadyInstalled) {
              const guardFeedback = [
                `[REDUNDANT_INSTALL_SKIP]`,
                `Command: "${cmd}"`,
                `EXECUTION SKIPPED: every requested package (${alreadyInstalled.join(', ')}) is declared in package.json AND already present in node_modules.`,
                `Re-running this install would do nothing but waste time.`,
                `Directive: proceed with the next step of your plan -- this dependency is already installed.`,
              ].join('\n')
              logger.log('WARN', 'AgentToolExecutor', `[REDUNDANT_INSTALL_SKIP] Skipped already-installed packages: ${alreadyInstalled.join(', ')}`)
              return { outputForHistory: guardFeedback, logMessage: `[REDUNDANT_INSTALL_SKIP] Skipped already-installed: ${alreadyInstalled.join(', ')}`, isTerminal: true }
            }
          }
        }

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
        const lowerOut = rawOutput.toLowerCase()

          // Failure is decided by the process's own exit status, not by scanning its output
          // for words like "Error:" or "FAIL" — those matched grep hits, verbose build logs and
          // passing test suites, sending successful commands into the auto-healing loop.
          // (persistentPowerShellSession combines $LASTEXITCODE with $? so pure-PowerShell
          // failures are reported too.) Cancellation is kept: an interactive generator that
          // aborts can still exit 0.
          if (isFailure) {
            const isEperm = lowerOut.includes('eperm') || lowerOut.includes('eacces') || lowerOut.includes('operation not permitted') || lowerOut.includes('permission denied')
            const permsDirective = isEperm
              ? `\n\n[PERMISSIONS WARNING: EPERM DETECTED]\nCommand failed due to Windows file permission restrictions (EPERM / Access Denied). DO NOT attempt to write files or run npm install inside system-protected folders (Program Files). Move the project or work inside a user workspace directory (e.g. Desktop or Documents).`
              : ''
            const isZeroModulesVite = lowerOut.includes('0 modules transformed') || (lowerOut.includes('vite') && res.code !== 0)
            const viteMissingDirective = isZeroModulesVite && workspacePath && !documentIoRepository.exists(path.join(workspacePath, 'index.html'))
              ? `\n\n[VITE ENTRY POINT MISSING DIAGNOSTIC]\nVite build failed or transformed 0 modules because 'index.html' is missing in project root ('${workspacePath}'). Create 'index.html' (referencing '<script type="module" src="/src/main.tsx"></script>') and 'src/main.tsx' before re-running build.`
              : ''
            const isCreateViteCancelled = (cmd.includes('create-vite') || cmd.includes('create vite') || cmd.includes('create-app')) && isCancelled
            const createViteDirective = isCreateViteCancelled
              ? `\n\n[VITE CLI NON-INTERACTIVE DIRECTIVE]\n'npm create vite' was cancelled because the target directory is not empty or requires interactive prompt selections. DO NOT re-run 'npm create vite' interactively.\nInstead, construct 'package.json', 'index.html', and 'src/main.tsx' directly using write_file, or run 'npx -y create-vite@latest . -- --template react-ts' after clearing conflicting files.`
              : ''
            // A peer-version conflict, parsed from npm's own report. Placed before the
            // missing-dependency branch because ERESOLVE output also mentions unresolved
            // packages, and "install the missing dependency" is the advice that just failed.
            const resolutionConflictDirective = npmResolutionDirectiveFor(rawOutput)
            // ETARGET: a version that was never published. Its sibling ERESOLVE has been handled
            // since §5.3 and this case never was, so run 17 of 2026-08-25 repeated the same
            // refused install until the circuit breaker stopped the session. Placed after
            // ERESOLVE because that output can also mention versions, and a peer conflict is a
            // different fix.
            const versionNotFound = resolutionConflictDirective ? null : parseVersionNotFound(rawOutput)
            const versionNotFoundDirective = versionNotFound
              ? buildVersionNotFoundDirective(versionNotFound, (await npmRegistryClient.lookup(versionNotFound.packageName)).latest)
              : ''
            // "Cannot find module X" is two different failures wearing one message, and telling
            // them apart needs the disk, not the text: a package that is already in node_modules
            // cannot be installed into existence again. See moduleResolutionDiagnostic.ts for the
            // runs that spent their steps reinstalling packages that were already there.
            const unresolved = resolutionConflictDirective ? [] : unresolvedPackages(rawOutput)
            const moduleCause = workspacePath && unresolved.length > 0
              ? classifyModuleDiagnostic(rawOutput, (pkg) => agentToolFileRepository.missingFromNodeModules(workspacePath, [pkg]).length === 0)
              : 'none'
            const moduleResolutionDirective = moduleCause === 'compiler_resolution'
              ? buildModuleResolutionDirective(rawOutput, unresolved)
              : ''
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
            const cannotFindModulePhrasing = lowerOut.includes('cannot find module')
            const bundlerMissingPhrasing =
              lowerOut.includes('module_not_found') || lowerOut.includes('failed to resolve import')
            const isMissingDependency =
              !resolutionConflictDirective &&
              moduleCause !== 'compiler_resolution' &&
              ((cannotFindModulePhrasing && unresolved.length > 0) || bundlerMissingPhrasing)
            // Naming them is the whole difference between an instruction and a riddle: the old
            // text shipped the literal placeholder `<package-name>` and left the model to invent
            // one. `unresolved` already holds the answer (§6.2.1).
            const missingDepList = unresolved.slice(0, 5).map((p) => `"${p}"`).join(', ')
            const missingDepDirective = isMissingDependency
              ? `\n\n[MISSING DEPENDENCY DIAGNOSTIC]\nCompilation failed because ${missingDepList ? `${missingDepList} ${unresolved.length === 1 ? 'is' : 'are'} imported but not installed` : 'an imported module/package is missing'}.\nDirectives:\n1. Your next tool call MUST be "run_command" with: npm install ${missingDepList ? unresolved.slice(0, 5).join(' ') : '<the package named in the error above>'}\n2. Do NOT re-run the project check until that install has completed.`
              : ''
            const isNpmNamingRestriction =
              lowerOut.includes('npm naming restrictions') ||
              lowerOut.includes('can no longer contain capital letters') ||
              lowerOut.includes('name can only contain url-friendly') ||
              lowerOut.includes('name is invalid')
            const npmNamingDirective = isNpmNamingRestriction
              ? `\n\n[NPM NAMING RESTRICTION DIRECTIVE]\nProject/package name is invalid because npm packages cannot contain uppercase letters or spaces. DO NOT repeat the command with capital letters. Either run with an all-lowercase name (e.g. 'project-dashboard-task') or construct the files directly using write_file (e.g. 'package.json', 'vite.config.ts', 'index.html', 'src/App.tsx').`
              : ''
            const interactivePromptDirective = res.interruptedByPrompt
              ? `\n\n[INTERACTIVE PROMPT DIRECTIVE]\nThe command was aborted because it requested interactive user input (e.g. a [y/n] confirmation or password prompt), which run_command cannot answer. Re-run using the tool's non-interactive flag (e.g. -y, --yes, --force, --batch) so it completes without prompting.`
              : ''
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
              permsDirective || resolutionConflictDirective || versionNotFoundDirective || viteMissingDirective ||
              createViteDirective || missingDepDirective || moduleResolutionDirective || npmNamingDirective || interactivePromptDirective
            )
            const diagnosticDirective = specificDirectiveFired
              ? null
              : buildDiagnosticFixDirective(
                  rawOutput,
                  (pkg) => (workspacePath ? readPackageExports(workspacePath, pkg) : []),
                  (importingFile, specifier) =>
                    workspacePath ? readLocalModuleExports(workspacePath, importingFile, specifier) : []
                )
            // The errors the winning directive does not fix, named so they stop being invisible,
            // and explicitly deferred so this stays one instruction for now. See
            // buildDeferredDiagnosticNote for the two runs that lost them.
            const deferredDiagnosticNote = specificDirectiveFired ? buildDeferredDiagnosticNote(rawOutput) || '' : ''
            const healingTail = specificDirectiveFired
              ? 'DO NOT ask the user vague clarification questions: carry out the directive above.'
              : diagnosticDirective ||
                'AUTO-HEALING DIRECTIVE: The command above failed. DO NOT ask the user vague clarification questions, and do NOT re-run it unchanged — it will fail the same way. Read the output above, identify the one file or command parameter at fault, and fix that with write_file.'
            const autoHealingFeedback = `[TERMINAL AUTO-HEALING DIAGNOSTICS LOG]
Command: "${cmd}" (Exit Code: ${res.code}${res.timedOut ? ' - TIMED OUT' : ''}${res.interruptedByPrompt ? ' - INTERACTIVE PROMPT DETECTED' : ''})
Captured Error Stack Trace & Failure Output:
\`\`\`
${rawOutput.slice(0, 4000)}
\`\`\`${permsDirective}${resolutionConflictDirective}${versionNotFoundDirective}${viteMissingDirective}${createViteDirective}${missingDepDirective}${moduleResolutionDirective}${npmNamingDirective}${interactivePromptDirective}${deferredDiagnosticNote}

${healingTail}`
            return {
              outputForHistory: autoHealingFeedback,
              logMessage: `Terminal Command Failed (Auto-Healing Diagnostic Captured)`,
              logDetail: rawOutput.slice(0, 1000),
              isTerminal: true,
            }
          }

          return {
            outputForHistory: `Ran command: "${cmd}"\nOutput:\n${rawOutput}`,
            logMessage: `Terminal Command Finished: ${cmd}`,
            logDetail: rawOutput.slice(0, 1000),
            isTerminal: true,
          }
      }

      case 'run_tests': {
        if (settings.allowTerminalExecution === false) {
          return { outputForHistory: 'Terminal command execution disabled in Settings.', logMessage: 'Terminal command execution disabled in Settings.', isTerminal: true }
        }
        return executeRunTestsTool(parameters.command, workspacePath, (path) => this.getOrCreateShellSession(path), onTerminalOutput, onProcessSpawned)
      }

      case 'git_status': {
        const cwd = workspacePath || process.cwd()
        return executeGitStatus(cwd, (directory, command, timeoutMs) => gitCliRepository.run(directory, command, timeoutMs))
      }

      case 'git_diff': {
        const cwd = workspacePath || process.cwd()
        const targetPath = parameters.filePath
        const isStaged = Boolean(parameters.staged)
        const pathCheck = targetPath ? validatePathSafety(targetPath, workspacePath) : null

        return executeGitDiff(cwd, targetPath, isStaged, pathCheck, (directory, command, timeoutMs) => gitCliRepository.run(directory, command, timeoutMs))
      }

      case 'git_commit': {
        const cwd = workspacePath || process.cwd()
        const result = this.performGitCommit(cwd, parameters.commitMessage || '')
        return {
          outputForHistory: result.output,
          logMessage: result.logMessage,
        }
      }

      case 'rollback_workspace': {
        return this.recoveryToolService.executeRollbackWorkspace()
      }

      case 'rollback_last_step': {
        return this.recoveryToolService.executeRollbackLastStep()
      }

      case 'get_file_info': {
        return executeFileInfoTool(parameters, workspacePath, agentToolFileRepository)
      }

      case 'open_in_browser': {
        return this.browserToolService.executeOpenInBrowser(parameters, workspacePath)
      }

      case 'ask': {
        const question = parameters.question || parameters.query || parsedTool.explanation || 'Clarification requested from user.'
        return {
          outputForHistory: `Agent requested clarification: "${question}"`,
          logMessage: `Agent Question: ${question}`,
          logDetail: question,
        }
      }

      default:
        return {
          outputForHistory: `Unrecognized or unsupported tool: ${tool}`,
          logMessage: `Unsupported tool ${tool}`,
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
