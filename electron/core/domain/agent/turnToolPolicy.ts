import type { SupportedToolName } from './agentTypes'
import type { PlanDirectiveKind } from './planDirectiveArbiter'

export type EditTargetState = 'existing' | 'missing' | 'unknown'

export interface TurnToolPolicyInput {
  directiveKind: PlanDirectiveKind
  editTargetState: EditTargetState
  userTask: string
  /** Tools the directive itself orders beyond the file edit (PlanDirectiveDecision.requiredTools). */
  requiredTools?: readonly SupportedToolName[]
}

export interface TurnToolPolicy {
  allowedTools: readonly SupportedToolName[]
  rationale: string
  requiredReadPath?: string
}

const EXPLORATION_TOOLS: readonly SupportedToolName[] = [
  'read_file',
  'get_file_info',
  'extract_code_symbols',
  'list_dir',
  'list_files_recursive',
  'grep_search',
]

function requestedAdvancedTools(task: string): SupportedToolName[] {
  const normalized = task.toLowerCase()
  const tools: SupportedToolName[] = []
  const add = (...names: SupportedToolName[]) =>
    names.forEach((name) => {
      if (!tools.includes(name)) tools.push(name)
    })

  if (/\b(web|online|internet|documentazione ufficiale|official docs?|latest|ultima versione|current api)\b/.test(normalized)) {
    add('web_search', 'fetch_web_content')
  }
  if (/https?:\/\/|\bscaric(?:a|are|amento)|\bdownload\b/.test(normalized)) add('download_file')
  if (/\bgit\b|\bcommit\b|\bdiff\b|\bworking tree\b/.test(normalized)) add('git_status', 'git_diff', 'git_commit')
  if (/\brollback\b|\bundo\b|\brevert\b|\bripristin/.test(normalized)) add('rollback_last_step', 'rollback_workspace')
  if (/\b(os|ambiente|environment|cpu|ram|vram|toolchain)\b/.test(normalized)) add('inspect_os_env')
  if (/\b(installa|install|ensure).{0,20}\b(node|npm|pnpm|git|python|ollama)\b/.test(normalized)) add('ensure_tool')
  if (/\b(browser|preview|anteprima|render|screenshot|visuale)\b/.test(normalized)) {
    add('open_in_browser', 'validate_visual_artifact')
  }
  if (/\b(run|esegui|lancia)\b.{0,30}\b(command|comando|test|build|typecheck|lint)\b|\b(test|build|typecheck|lint)(?: suite)?\b/.test(normalized))
    add('run_command')
  if (/\bcrea(?:re)? (?:la |una )?cartella\b|\bcreate (?:a )?director/.test(normalized)) add('create_directory')
  if (/\bcopia(?:re)?\b|\bcopy\b/.test(normalized)) add('copy_file')
  if (/\bsposta(?:re)?\b|\brinomina(?:re)?\b|\bmove\b|\brename\b/.test(normalized)) add('move_file')
  if (/\belimina(?:re)?\b|\bcancella(?:re)?\b|\bdelete\b|\bremove\b/.test(normalized)) add('delete_file')

  return tools
}

function editToolFor(state: EditTargetState): SupportedToolName | null {
  if (state === 'existing' || state === 'missing') return 'write_file'
  return null
}

function requestsFileMutation(task: string): boolean {
  const directMutation =
    /\b(create|add|update|change|edit|fix|refactor|implement|crea|aggiungi|aggiorna|modifica|cambia|correggi|rifattorizza|implementa|costruisci|sviluppa|realizza|prepara|genera)\b/i
  const italianColloquialBuild =
    /\b(fammi|fai)\b(?!\s+(vedere|capire|spiegare|analizzare|controllare|ispezionare)\b)(?:\s+\S+){0,4}\s+\b(sito|pagina|app|applicazione|progetto|componente|file|codice|interfaccia|dashboard|gioco|script)\b/i
  return directMutation.test(task) || italianColloquialBuild.test(task)
}

/** Selects the smallest useful tool surface for one model proposal. */
export function resolveTurnToolPolicy(input: TurnToolPolicyInput): TurnToolPolicy {
  const advanced = requestedAdvancedTools(input.userTask)
  const controls: SupportedToolName[] = ['ask', 'update_plan']
  const policy = (tools: readonly SupportedToolName[], rationale: string): TurnToolPolicy => {
    const allowed = new Set([...tools, ...controls, ...advanced])
    // A shell command that prints one file already runs as read_file, so denying the direct call only
    // costs a turn: live gpt-oss:20b run 4 of 2026-09-24 lost 8 of 41 steps to read_file denials
    // while its `sed -n`/`cat` reads of the same files went through.
    if (allowed.has('run_command')) allowed.add('read_file')
    return { allowedTools: Array.from(allowed), rationale }
  }

  switch (input.directiveKind) {
    case 'session_closure':
      return { allowedTools: ['finish'], rationale: 'verified work only needs the terminal report' }
    case 'dependencies_undeclared':
    case 'dependencies_missing':
      return policy(['run_command'], 'the application selected an exact dependency command')
    case 'verification_due':
      return policy(['run_command'], 'the application selected the project verification command')
    case 'behavior_test_runner_missing':
      return policy(['run_command'], 'the application selected the smoke-test runner install')
    case 'dependencies_uninstallable':
    case 'verification_failing':
    case 'dependencies_unpublished':
    case 'behavior_test_script_missing':
    case 'entrypoint_disconnected': {
      const editTool = editToolFor(input.editTargetState) ?? 'write_file'
      const tools = [...(input.requiredTools ?? []), editTool]
      return policy(tools, `the current correction needs only ${tools.join(' and ')}`)
    }
    case 'unprovable_milestone':
      return policy([], 'only plan state can advance this milestone')
    case 'focus': {
      const editTool = editToolFor(input.editTargetState) ?? (requestsFileMutation(input.userTask) ? 'write_file' : null)
      return editTool
        ? policy([editTool], `the active deliverable needs only ${editTool}`)
        : policy(EXPLORATION_TOOLS, 'the next target is not known, so this turn is read-only exploration')
    }
  }
}

export function resolveVersionConflictTurnPolicy(filePath: string): TurnToolPolicy {
  return {
    allowedTools: ['read_file'],
    rationale: `the stale edit must be refreshed from ${filePath}`,
    requiredReadPath: filePath,
  }
}
