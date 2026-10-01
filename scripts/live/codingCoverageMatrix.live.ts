import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { OLLAMA_TOOL_SCHEMA_CATALOG } from '../../electron/core/domain/agent/ollamaToolSchemaCatalog'
import { LIVE_RUN_ROOT } from './agentLiveHarness'
import { TASKLAB_PROMPT_VERSION, TASKLAB_STAGES } from './taskLabPrompts'

interface TestReport {
  success: boolean
  testResults: Array<{ name: string; assertionResults: Array<{ fullName: string; status: string }> }>
}
interface EvidenceReference {
  file: string
  title: string
}
const reference = (file: string, title: string): EvidenceReference => ({ file, title })
const executor = (title: string) => reference('agentToolExecutorService.test.ts', title)
const liveScenario = (title: string) => reference('codingScenarios.live.ts', title)
const browser = reference('agentBrowser.e2e.ts', 'navigates, clicks, fills, captures a private screenshot')
const server = reference('managedDevServerRepository.test.ts', 'starts only the workspace dev script, probes loopback and stops only its owned process')
const references: Record<string, EvidenceReference[]> = {
  read_file: [executor('execute write_file and read_file'), reference('readFileTool.test.ts', 'returns the content with its version')],
  extract_code_symbols: [executor('extract code symbols from TypeScript')],
  list_dir: [reference('listDirectoryTool.test.ts', 'lists entries through the repository boundary')],
  list_files_recursive: [executor('execute list_files_recursive and get_file_info')],
  grep_search: [reference('fsToolService.test.ts', 'limits displayed matches to the first 50 while preserving the total count')],
  web_search: [reference('webResearchTools.test.ts', 'formats search results and preserves the research directive')],
  fetch_web_content: [reference('webClient.test.ts', 'fetches a page and converts it to markdown')],
  write_file: [executor('rejects stale or unversioned whole-file rewrites')],
  create_directory: [executor('execute create_directory, copy_file, and move_file')],
  copy_file: [reference('fsToolService.test.ts', 'records the destination and rollback removes the copied file')],
  move_file: [reference('fsToolService.test.ts', 'journals both paths so rollback restores the source and removes the target')],
  replace_file_content: [executor('execute replace_file_content and return auto-healing feedback')],
  multi_replace_file_content: [reference('multiReplaceFileContentTool.test.ts', 'rejects an ambiguous batch before journaling or writing partial content')],
  delete_file: [executor('report change stats for replace_file_content and delete_file')],
  download_file: [reference('webClient.test.ts', 'writes a completed download to disk')],
  run_command: [reference('persistentPowerShellSession.test.ts', 'preserve environment variable state across sequential commands')],
  run_tests: [
    executor('graceful message when run_tests has no explicit command'),
    reference('agentOrchestratorBuildFreshness.test.ts', 'structured run_tests retains the command that establishes milestone proof'),
  ],
  start_dev_server: [server],
  probe_local_http: [server],
  stop_dev_server: [server],
  inspect_os_env: [executor('include the development toolchain inventory in inspect_os_env')],
  git_status: [executor('execute git_status and git_diff')],
  git_diff: [executor('execute git_status and git_diff')],
  git_commit: [reference('agentOrchestratorAppService.test.ts', 'always pause for human approval on git_commit in Auto mode')],
  rollback_last_step: [executor('execute rollback_last_step and undo only the most recent step')],
  get_file_info: [executor('execute list_files_recursive and get_file_info')],
  ensure_tool: [executor('refuse to install anything outside the toolchain allow-list')],
  update_plan: [reference('agentOrchestratorAppService.test.ts', 'refused milestone promotion in the changing turn context')],
  ask: [reference('agentOrchestratorAppService.test.ts', 'persists application closure when ask recovery is exhausted')],
  open_in_browser: [executor('open_in_browser parameter validation and missing target')],
  validate_visual_artifact: [reference('agentBrowser.e2e.ts', 'captures real page errors and missing resources')],
  browser_navigate: [browser],
  browser_snapshot: [browser],
  browser_click: [browser],
  browser_fill: [browser],
  browser_screenshot: [browser],
  finish: [reference('agentOrchestratorAppService.test.ts', 'route finish through the application evidence gate')],
}
const areas: Array<{ area: string; reference?: EvidenceReference; liveReference?: EvidenceReference; limitation: string }> = [
  {
    area: 'Interview and confirmed storage decision',
    reference: reference('agentInterviewAppService.test.ts', 'forwards only the selected model sampling preferences to the interview'),
    liveReference: liveScenario('interviews for persistence and enriches the prompt with an explicit localStorage choice'),
    limitation: 'Live interview and explicit answer only; application persistence and reload remain unqualified.',
  },
  {
    area: 'Planning and reviewer sampling',
    reference: reference('planGenerationAppService.test.ts', 'forwards only the selected model sampling preferences to planning and coverage'),
    limitation: 'Strict live wire artifacts confirm 9B thinking; complete TaskLab planning remains blocked.',
  },
  {
    area: 'Fail-closed request inventory',
    reference: reference('planRequestCoverage.test.ts', 'rejects a review that silently omits another request line'),
    limitation: 'Indexed validation passes; real global/local false positives remain unresolved after ten attempts.',
  },
  {
    area: 'Retained verified work across revisions',
    reference: reference('planGenerationAppService.test.ts', 'retains distinct verified work when a later revision reuses canonical intervention IDs'),
    limitation: 'Deterministic collision regression; the resumed TaskLab stage has not executed.',
  },
  {
    area: 'Canonical behavioral test gate',
    reference: reference('planCompilation.test.ts', 'retains the canonical behavioral gate when the model already names its test file'),
    limitation: 'Build-only promotion is rejected by regression tests; live confirmation after the fix was blocked at planning.',
  },
  {
    area: 'Partial reading and version evidence',
    reference: reference('agentOrchestratorTurnFileContext.test.ts', 'support fragments and visible omission markers'),
    liveReference: liveScenario('reads ranges, metadata, symbols and search in Ask without mutations'),
    limitation: 'Live lines 2-4 plus metadata, symbols and search in a declared isolated fixture; broader files are separate.',
  },
  {
    area: 'Ask read-only',
    reference: reference('agentOrchestratorAppService.test.ts', 'keeps Ask read-only when Full access is selected'),
    liveReference: liveScenario('reads ranges, metadata, symbols and search in Ask without mutations'),
    limitation: 'Live fixture source and directory inventory unchanged; this does not qualify every Ask request.',
  },
  {
    area: 'Guided approval and rejection',
    reference: reference('agentOrchestratorAppService.test.ts', 'denial back to the model'),
    liveReference: liveScenario('repairs a declared import fault in Guided with accepted consent and frozen tests'),
    limitation: 'Accepted consent and frozen-test import recovery verified live; ordinary refusal recovery has a separate evidence row.',
  },
  {
    area: 'Rejected mutation and owned-run stop',
    liveReference: liveScenario('rejects a Guided write and stops its owned run without changing the fixture'),
    limitation: 'Native consent rejected and fixture unchanged; intentional cancellation does not prove resumed recovery.',
  },
  {
    area: 'Auto Git commit consent',
    reference: reference('agentOrchestratorAppService.test.ts', 'always pause for human approval on git_commit in Auto mode'),
    liveReference: liveScenario('requires Git commit consent in Auto and leaves the isolated repository unborn'),
    limitation: 'Actual consent rejected; Git HEAD remains absent. No commit is authorized or created.',
  },
  {
    area: 'Filesystem mutations and per-step rollback',
    reference: reference('fsToolService.test.ts', 'journals both paths so rollback restores the source and removes the target'),
    liveReference: liveScenario('creates, edits, copies, moves, deletes and rolls back isolated files with frozen verification'),
    limitation: 'Declared isolated seed, frozen test and exact contents; full checkpoint restoration remains separate.',
  },
  {
    area: 'Structured test-tool milestone proof',
    reference: reference('agentOrchestratorBuildFreshness.test.ts', 'structured run_tests retains the command that establishes milestone proof'),
    liveReference: liveScenario('rejects a stale file proposal and preserves a declared concurrent edit during recovery'),
    limitation:
      'Actual npm test command promotes its milestone; differing commands and unusable test scripts remain rejected. Node summary parsing remains unknown.',
  },
  {
    area: 'Ordinary refused-consent recovery',
    reference: reference('agentOrchestratorAppService.test.ts', 'denial back to the model'),
    liveReference: liveScenario('continues with read-only recovery after refused Guided consent without cancellation'),
    limitation:
      'One refusal, fresh read and native finish, no cancellation or mutation. The application correctly returns unverifiable without a behavior runner.',
  },
  {
    area: 'Checkpoint and rollback',
    reference: reference('agentCheckpointStore.test.ts', 'restores the pre-run state on request'),
    limitation: 'Isolated filesystem fixture; no user data is rolled back.',
  },
  {
    area: 'Interrupted-run identity and resume',
    reference: reference('agentOrchestratorSessionState.test.ts', 'restores only an interrupted state for the matching run'),
    limitation: 'TaskLab continuation additionally requires its final resumed stage.',
  },
  {
    area: 'Concurrent modifications',
    reference: reference('agentToolExecutorService.test.ts', 'rejects stale or unversioned whole-file rewrites'),
    liveReference: liveScenario('rejects a stale file proposal and preserves a declared concurrent edit during recovery'),
    limitation:
      'One declared concurrent edit during approval: native CAS refusal, reread, preserved collaborator line and independent frozen tests. Other races remain separate.',
  },
  {
    area: 'Session isolation and serial queue',
    reference: reference('taskQueueAppService.test.ts', 'cancels only that queued run'),
    limitation: 'Queue fixtures do not imply concurrent live model qualification.',
  },
  {
    area: 'Context compaction',
    reference: reference('episodicMemoryCompactor.test.ts', 'retaining only maxRecentDetailedSteps'),
    limitation: 'Real long-session compaction and retained decisions need transcript evidence.',
  },
  {
    area: 'Skill selection',
    reference: reference('skillMatcher.test.ts', 'match skills based on projectStack'),
    limitation: 'Main campaign uses isolated defaults; installed personal skills are not modified.',
  },
  {
    area: 'Skill adherence',
    reference: reference('agentToolExecutorService.test.ts', 'forbidden by an active skill'),
    limitation: 'Declared deterministic guideline fixture; real 9B adherence remains separate.',
  },
  {
    area: 'Network consent and provenance',
    reference: reference('agentToolExecutorService.test.ts', 'requires explicit network-approved consent'),
    limitation: 'Public search/fetch availability is not inferred from mocked responses.',
  },
  {
    area: 'Shell cancellation and timeout',
    reference: reference('persistentPowerShellSession.test.ts', 'times out an in-flight command and recreates the shell'),
    limitation: 'Owned PowerShell fixture; no foreign process is terminated.',
  },
  {
    area: 'Thinking timeout',
    reference: reference('agentStreamTransport.test.ts', 'cuts a turn that keeps reasoning past its budget'),
    limitation: '18-minute real thinking cut OPEN until a real generation crosses the unchanged budget.',
  },
  {
    area: 'Loop guards',
    reference: reference('agentOrchestratorAppService.test.ts', 'model stops issuing tool calls'),
    limitation: 'Real 9B closures and guard IDs must be read from live session artifacts.',
  },
  { area: 'OOM safeguards', limitation: 'No real OOM is induced or claimed; memory safeguards remain enabled and this area is an explicit live limit.' },
  {
    area: 'Managed browser shutdown',
    reference: reference('agentBrowser.e2e.ts', 'closes the context on cancellation'),
    limitation: 'Real Chromium fixture; model-directed lifecycle is separate.',
  },
]

it('records catalog tools, implemented areas and explicit qualification limits from actual evidence', () => {
  const reportPaths = (process.env.ONLYRAG_MATRIX_REPORTS || '').split(path.delimiter).filter(Boolean)
  expect(reportPaths.length, 'Provide passed Vitest JSON reports through ONLYRAG_MATRIX_REPORTS.').toBeGreaterThan(0)
  const reports = reportPaths.map((file) => ({ file, report: JSON.parse(fs.readFileSync(file, 'utf8')) as TestReport }))
  const passing = reports
    .filter(({ report }) => report.success)
    .flatMap(({ file, report }) =>
      report.testResults.flatMap((result) =>
        result.assertionResults
          .filter((assertion) => assertion.status === 'passed')
          .map((assertion) => ({ report: file, file: result.name.replace(/\\/g, '/'), title: assertion.fullName })),
      ),
    )
  const proof = (refs: EvidenceReference[]) => refs.flatMap((ref) => passing.filter((test) => test.file.endsWith(ref.file) && test.title.includes(ref.title)))
  const roots = [
    ...new Set(
      (process.env.ONLYRAG_MATRIX_LIVE_ROOTS || '')
        .split(path.delimiter)
        .filter(Boolean)
        .map((root) => path.resolve(root)),
    ),
  ]
  const observed: Array<{ tool: string; status: string; file: string }> = []
  const sequences: Array<{ root: string; conversation: string; workspace: string; qualified: boolean }> = []
  for (const root of roots) {
    const sequenceFile = path.join(root, 'sequence.json')
    if (fs.existsSync(sequenceFile)) {
      const sequence = JSON.parse(fs.readFileSync(sequenceFile, 'utf8')) as {
        conversation: string
        workspace: string
        version: string
        qualified: boolean
        results: Array<{ stage: string; passed: boolean }>
      }
      const qualified =
        sequence.qualified &&
        sequence.version === TASKLAB_PROMPT_VERSION &&
        JSON.stringify(sequence.results.map((result) => result.stage)) === JSON.stringify(TASKLAB_STAGES.map((stage) => stage.id)) &&
        sequence.results.every((result) => result.passed)
      sequences.push({ root, conversation: sequence.conversation, workspace: sequence.workspace, qualified })
    }
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).filter((item) => item.isDirectory())) {
      const file = path.join(root, entry.name, 'session.json')
      if (!fs.existsSync(file)) continue
      const state = JSON.parse(fs.readFileSync(file, 'utf8')) as { episodes?: Array<{ tool: string; status: string }> }
      observed.push(...(state.episodes || []).map((episode) => ({ ...episode, file })))
    }
  }
  const tools = OLLAMA_TOOL_SCHEMA_CATALOG.map(({ function: { name } }) => ({
    tool: name,
    deterministic: proof(references[name] || []),
    live: observed.filter((episode) => episode.tool === name),
    limitation:
      name === 'open_in_browser'
        ? 'Parameter validation only; native desktop launch is not qualified.'
        : name === 'git_commit'
          ? 'Mandatory consent tested; no live commit authorized.'
          : name === 'run_tests'
            ? 'Command propagation and negative promotion cases tested; live Node tests independently pass although summary parsing is unknown.'
            : 'Observed calls do not establish every behavior or negative path.',
  }))
  const functionality = areas.map((item) => ({
    ...item,
    deterministic: item.reference ? proof([item.reference]) : [],
    live: item.liveReference ? proof([item.liveReference]) : [],
  }))
  const independent = sequences.filter((sequence) => sequence.qualified)
  const qualified =
    new Set(independent.map((sequence) => sequence.conversation)).size >= 2 && new Set(independent.map((sequence) => sequence.workspace)).size >= 2
  const root = path.join(LIVE_RUN_ROOT, `coding-matrix-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`)
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(
    path.join(root, 'matrix.json'),
    JSON.stringify({ createdAt: new Date().toISOString(), reports: reportPaths, sequences, qualified, tools, functionality }, null, 2),
    'utf8',
  )
  const rows = tools.map(
    (item) =>
      `| ${item.tool} | ${item.live.filter((event) => event.status === 'SUCCESS').length} successful / ${item.live.length} observed | ${item.deterministic.map((test) => `${path.basename(test.file)}: ${test.title}`).join('; ') || 'No matching passed case'} | ${item.limitation} |`,
  )
  fs.writeFileSync(
    path.join(root, 'matrix.md'),
    `# Coding Agent evidence matrix\n\nTaskLab two-sequence qualification: ${qualified ? 'PASSED' : 'OPEN'}.\n\nLive calls are observations, not blanket qualification. Evidence rows cite actual passed assertions and their JSON report is retained in matrix.json. Unmatched cases are explicit limits.\n\n| Catalog tool | Live | Deterministic evidence | Limit |\n|---|---|---|---|\n${rows.join('\n')}\n\n| Area | Live assertion | Deterministic evidence | Limit |\n|---|---|---|---|\n${functionality.map((item) => `| ${item.area} | ${item.live.map((test) => `${path.basename(test.file)}: ${test.title}`).join('; ') || 'Not verified'} | ${item.deterministic.map((test) => `${path.basename(test.file)}: ${test.title}`).join('; ') || 'Not verified'} | ${item.limitation} |`).join('\n')}\n`,
    'utf8',
  )
  expect(tools).toHaveLength(OLLAMA_TOOL_SCHEMA_CATALOG.length)
  console.log(`Evidence matrix: ${root}; TaskLab qualified=${qualified}`)
})
