/**
 * src/components/coding/agentLogMessageUtils.ts
 *
 * Presentation / Utility Layer — Message categorization, language badges, and model tag resolution.
 * Provides deterministic structured parsing for agent activity logs (Claude Code UX standard).
 */

export type AgentLogCategory =
  | 'user_prompt'
  | 'agent_question'
  | 'file_mutation'
  | 'command_execution'
  | 'test_run'
  | 'workspace_exploration'
  | 'web_research'
  | 'plan_update'
  | 'generic_assistant'

export type MutationVerb = 'Edited' | 'Created' | 'Deleted' | 'Moved' | 'Copied'

export interface FileMutationDetails {
  verb: MutationVerb
  fileName: string
  filePath: string
  summary?: string
}

export interface CommandExecutionDetails {
  command: string
  isInstall: boolean
}

export interface TestRunDetails {
  isPass: boolean
  summary: string
  passedCount?: number
  failedCount?: number
}

export interface WorkspaceExplorationDetails {
  action: 'Read' | 'Grep' | 'List' | 'Symbols' | 'Explored'
  target: string
}

export interface WebResearchDetails {
  action: 'Search' | 'Fetch' | 'Download'
  queryOrUrl: string
}

export interface CategorizedAgentLog {
  category: AgentLogCategory
  userPromptText?: string
  agentQuestionText?: string
  fileMutation?: FileMutationDetails
  commandExecution?: CommandExecutionDetails
  testRun?: TestRunDetails
  workspaceExploration?: WorkspaceExplorationDetails
  webResearch?: WebResearchDetails
}

export function getStepModelName(message: string, fallbackModelName?: string): string {
  if (!message) return fallbackModelName || 'LLM'

  const consultingMatch = message.match(/Consulting LLM \(([^)]+)\)/i)
  if (consultingMatch && consultingMatch[1]) {
    return consultingMatch[1].trim()
  }

  const complexityMatch = message.match(/(?:Complexity Escalated|Escalation a Deep Reasoning|Escalated to|Escalating to):\s*([a-zA-Z0-9._:\-]+)/i)
  if (complexityMatch && complexityMatch[1]) {
    return complexityMatch[1].trim()
  }

  const bracketMatch =
    message.match(/fallback to \[([^\]]+)\]/i) ||
    message.match(/Escalating to heavy tier \[([^\]]+)\]/i) ||
    message.match(/Primary model \[([^\]]+)\]/i) ||
    message.match(/Intermediate model \[([^\]]+)\]/i)

  if (bracketMatch && bracketMatch[1]) {
    return bracketMatch[1].trim()
  }

  return fallbackModelName || 'LLM'
}

export function getBadgeLang(filename?: string): { label: string; color: string } {
  if (!filename) return { label: 'FILE', color: 'bg-slate-800 text-slate-300' }
  const lower = filename.toLowerCase()

  if (lower.endsWith('.tsx') || lower.endsWith('.ts')) {
    return { label: 'TS', color: 'bg-sky-950 text-sky-400 border border-sky-800/80 font-bold' }
  }
  if (lower.endsWith('.jsx') || lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return { label: 'JS', color: 'bg-amber-950 text-amber-300 border border-amber-800/80 font-bold' }
  }
  if (lower.endsWith('.py')) {
    return { label: 'PY', color: 'bg-amber-950 text-amber-400 border border-amber-800/80 font-bold' }
  }
  if (lower.endsWith('.json')) {
    return { label: 'JSON', color: 'bg-emerald-950 text-emerald-400 border border-emerald-800/80 font-bold' }
  }
  if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.sass') || lower.endsWith('.less')) {
    return { label: 'CSS', color: 'bg-indigo-950 text-indigo-400 border border-indigo-800/80 font-bold' }
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return { label: 'HTML', color: 'bg-orange-950 text-orange-400 border border-orange-800/80 font-bold' }
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return { label: 'MD', color: 'bg-cyan-950 text-cyan-400 border border-cyan-800/80 font-bold' }
  }
  if (lower.endsWith('.ps1') || lower.endsWith('.bat') || lower.endsWith('.cmd')) {
    return { label: 'PS1', color: 'bg-purple-950 text-purple-400 border border-purple-800/80 font-bold' }
  }
  if (lower.endsWith('.sh') || lower.endsWith('.bash') || lower.endsWith('.zsh')) {
    return { label: 'SH', color: 'bg-emerald-950 text-emerald-300 border border-emerald-800/80 font-bold' }
  }
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) {
    return { label: 'YAML', color: 'bg-rose-950 text-rose-400 border border-rose-800/80 font-bold' }
  }
  if (lower.endsWith('.toml')) {
    return { label: 'TOML', color: 'bg-pink-950 text-pink-400 border border-pink-800/80 font-bold' }
  }
  if (lower.endsWith('.sql')) {
    return { label: 'SQL', color: 'bg-blue-950 text-blue-400 border border-blue-800/80 font-bold' }
  }
  if (lower.endsWith('.rs')) {
    return { label: 'RS', color: 'bg-orange-950 text-orange-300 border border-orange-800/80 font-bold' }
  }
  if (lower.endsWith('.go')) {
    return { label: 'GO', color: 'bg-teal-950 text-teal-300 border border-teal-800/80 font-bold' }
  }
  return { label: 'FILE', color: 'bg-slate-800 text-slate-300' }
}

function cleanExtractedPath(rawPath: string): string {
  return rawPath.replace(/\s*\([^)]*\)$/, '').trim()
}

function extractBaseName(rawPath: string): string {
  const cleaned = cleanExtractedPath(rawPath)
  const normalized = cleaned.replace(/\\/g, '/')
  const segments = normalized.split('/')
  return segments[segments.length - 1] || cleaned
}

export function categorizeAgentLog(message: string, logType?: string): CategorizedAgentLog {
  const msg = message || ''

  // 1. User Prompt
  if (msg.startsWith('User Prompt: ')) {
    return {
      category: 'user_prompt',
      userPromptText: msg.replace('User Prompt: ', '').trim(),
    }
  }

  // 2. Agent Question / Clarification
  if (
    msg.includes('❓ AI Agent Question:') ||
    msg.startsWith('Agent Question:') ||
    msg.startsWith('Agent requested clarification:')
  ) {
    const qText = msg
      .replace('❓ AI Agent Question: ', '')
      .replace('Agent Question: ', '')
      .replace('Agent requested clarification: ', '')
      .trim()
    return {
      category: 'agent_question',
      agentQuestionText: qText,
    }
  }

  // 3. Test Run
  if (msg.includes('Test Run: PASS') || msg.includes('Test Run: FAIL') || msg.includes('run_tests')) {
    const isPass = msg.includes('Test Run: PASS') || msg.includes('PASS')
    const passMatch = msg.match(/(\d+)\s+passed/i)
    const failMatch = msg.match(/(\d+)\s+failed/i)
    return {
      category: 'test_run',
      testRun: {
        isPass,
        summary: msg,
        passedCount: passMatch ? parseInt(passMatch[1], 10) : undefined,
        failedCount: failMatch ? parseInt(failMatch[1], 10) : undefined,
      },
    }
  }

  // 4. File Mutations
  // 4a. write_file / creation
  const writeMatch = msg.match(/(?:Successfully wrote file|Created file|write_file.*?filePath":\s*")([^"\n]+)/i)
  if (writeMatch) {
    const rawPath = writeMatch[1].trim()
    const filePath = cleanExtractedPath(rawPath)
    return {
      category: 'file_mutation',
      fileMutation: {
        verb: 'Created',
        fileName: extractBaseName(filePath),
        filePath,
        summary: msg,
      },
    }
  }

  // 4b. replace_chunk / multi_replace / edit
  const replaceChunkMatch = msg.match(/(?:Successfully replaced target chunk in|Successfully replaced content in|replace_chunk.*?filePath":\s*")([^"\n]+)/i)
  if (replaceChunkMatch) {
    const rawPath = replaceChunkMatch[1].trim()
    const filePath = cleanExtractedPath(rawPath)
    return {
      category: 'file_mutation',
      fileMutation: {
        verb: 'Edited',
        fileName: extractBaseName(filePath),
        filePath,
        summary: msg,
      },
    }
  }

  const multiReplaceMatch = msg.match(/(?:Successfully applied \d+ replacements in|multi_replace.*?filePath":\s*")([^"\n]+)/i)
  if (multiReplaceMatch) {
    const rawPath = multiReplaceMatch[1].trim()
    const filePath = cleanExtractedPath(rawPath)
    return {
      category: 'file_mutation',
      fileMutation: {
        verb: 'Edited',
        fileName: extractBaseName(filePath),
        filePath,
        summary: msg,
      },
    }
  }

  const editedPrefixMatch = msg.match(/^Edited\s+([^\s]+)/)
  if (editedPrefixMatch) {
    const rawPath = editedPrefixMatch[1].trim()
    const filePath = cleanExtractedPath(rawPath)
    return {
      category: 'file_mutation',
      fileMutation: {
        verb: 'Edited',
        fileName: extractBaseName(filePath),
        filePath,
        summary: msg,
      },
    }
  }

  // 4c. delete_file
  const deleteMatch = msg.match(/(?:Successfully deleted file|delete_file.*?filePath":\s*")([^"\n]+)/i)
  if (deleteMatch) {
    const filePath = deleteMatch[1].trim()
    return {
      category: 'file_mutation',
      fileMutation: {
        verb: 'Deleted',
        fileName: extractBaseName(filePath),
        filePath,
        summary: msg,
      },
    }
  }

  // 4d. move_file / copy_file / create_directory
  const moveMatch = msg.match(/Successfully moved (.+?) -> (.+)/i)
  if (moveMatch) {
    const dstPath = moveMatch[2].trim()
    return {
      category: 'file_mutation',
      fileMutation: {
        verb: 'Moved',
        fileName: extractBaseName(dstPath),
        filePath: dstPath,
        summary: msg,
      },
    }
  }

  const copyMatch = msg.match(/Successfully copied (.+?) -> (.+)/i)
  if (copyMatch) {
    const dstPath = copyMatch[2].trim()
    return {
      category: 'file_mutation',
      fileMutation: {
        verb: 'Copied',
        fileName: extractBaseName(dstPath),
        filePath: dstPath,
        summary: msg,
      },
    }
  }

  const mkdirMatch = msg.match(/Successfully created directory (.+)/i)
  if (mkdirMatch) {
    const dirPath = mkdirMatch[1].trim()
    return {
      category: 'file_mutation',
      fileMutation: {
        verb: 'Created',
        fileName: extractBaseName(dirPath),
        filePath: dirPath,
        summary: msg,
      },
    }
  }

  // 5. Command Execution
  if (
    msg.includes('run_command') ||
    msg.startsWith('Ran ') ||
    msg.startsWith('Executed command:') ||
    logType === 'terminal'
  ) {
    const cmdMatch =
      msg.match(/run_command.*?"command":\s*"([^"]+)"/) ||
      msg.match(/Ran\s+(.+)/) ||
      msg.match(/Executed command:\s*(.+)/)
    const command = cmdMatch ? cmdMatch[1].trim() : msg
    const isInstall = /\b(npm|pnpm|yarn|pip|winget)\s+(install|add|i)\b/i.test(command)
    return {
      category: 'command_execution',
      commandExecution: {
        command,
        isInstall,
      },
    }
  }

  // 6. Web Research
  if (msg.includes('web_search') || msg.startsWith('Web search:')) {
    const qMatch = msg.match(/Web search:\s*(.+)/i) || msg.match(/"query":\s*"([^"]+)"/)
    return {
      category: 'web_research',
      webResearch: {
        action: 'Search',
        queryOrUrl: qMatch ? qMatch[1].trim() : msg,
      },
    }
  }

  if (msg.includes('fetch_web_content') || msg.startsWith('Fetched web content:')) {
    const urlMatch = msg.match(/Fetched web content:\s*(.+)/i) || msg.match(/"url":\s*"([^"]+)"/)
    return {
      category: 'web_research',
      webResearch: {
        action: 'Fetch',
        queryOrUrl: urlMatch ? urlMatch[1].trim() : msg,
      },
    }
  }

  if (msg.includes('download_file') || msg.startsWith('Downloaded file:')) {
    const urlMatch = msg.match(/Downloaded file:\s*(.+)/i) || msg.match(/"url":\s*"([^"]+)"/)
    return {
      category: 'web_research',
      webResearch: {
        action: 'Download',
        queryOrUrl: urlMatch ? urlMatch[1].trim() : msg,
      },
    }
  }

  // 7. Workspace Exploration
  if (
    msg.includes('read_file') ||
    msg.startsWith('Read file') ||
    msg.includes('list_dir') ||
    msg.startsWith('List dir') ||
    msg.includes('grep_search') ||
    msg.startsWith('Grep search') ||
    msg.includes('list_files_recursive') ||
    msg.startsWith('Recursive List:') ||
    msg.includes('extract_code_symbols') ||
    msg.startsWith('Explored ')
  ) {
    let action: WorkspaceExplorationDetails['action'] = 'Explored'
    let target = 'workspace'

    if (msg.startsWith('Read file') || msg.includes('read_file')) {
      action = 'Read'
      const m = msg.match(/Read file\s+([^\s]+)/i) || msg.match(/"filePath":\s*"([^"]+)"/)
      if (m) target = extractBaseName(m[1])
    } else if (msg.startsWith('Grep search') || msg.includes('grep_search')) {
      action = 'Grep'
      const m = msg.match(/Grep search:\s*"?([^"\n]+)"?/i) || msg.match(/"query":\s*"([^"]+)"/)
      if (m) target = m[1]
    } else if (msg.startsWith('List dir') || msg.includes('list_dir')) {
      action = 'List'
      const m = msg.match(/List dir\s+([^\s]+)/i) || msg.match(/"dirPath":\s*"([^"]+)"/)
      if (m) target = extractBaseName(m[1])
    } else if (msg.startsWith('Recursive List:') || msg.includes('list_files_recursive')) {
      action = 'List'
      const m = msg.match(/Recursive List:\s*\d+\s+items in\s+([^\s]+)/i)
      if (m) target = extractBaseName(m[1])
    } else if (msg.includes('extract_code_symbols')) {
      action = 'Symbols'
      const m = msg.match(/"filePath":\s*"([^"]+)"/)
      if (m) target = extractBaseName(m[1])
    }

    return {
      category: 'workspace_exploration',
      workspaceExploration: {
        action,
        target,
      },
    }
  }

  // 8. Plan Update
  if (msg.includes('[PLAN Mode]') || msg.includes('update_plan') || msg.startsWith('Plan milestone')) {
    return {
      category: 'plan_update',
    }
  }

  // 9. Generic Assistant Output
  return {
    category: 'generic_assistant',
  }
}
