import { useCallback, useState } from 'react'

const MAX_TERMINAL_LINES = 500
const DEFAULT_COMMAND_TIMEOUT_MS = 120000

const INITIAL_TERMINAL_LOGS = [
  'Windows PowerShell v7.4.1 (UTF-8)',
  'OnlyRag V2 AI Coding Agent Terminal Ready.',
  'Type command or ask AI Agent to run PowerShell tasks.',
  '',
]

/** Output patterns that mean the command never ran because the tool is missing from PATH. */
const MISSING_TOOL_PATTERNS = ['non è stato possibile trovare', 'is not recognized', 'CommandNotFoundException']

export interface UseAgentTerminalOptions {
  workspacePath: string | null
  /** Surfaces a failed or unresolvable command in the agent action log. */
  onCommandNotice: (command: string, output: string) => void
}

/**
 * Interactive PowerShell terminal of the Coding Agent Studio: user-typed commands and the
 * mirrored output of the commands the agent runs, capped to the last {@link MAX_TERMINAL_LINES} lines.
 */
export function useAgentTerminal({ workspacePath, onCommandNotice }: UseAgentTerminalOptions) {
  const [terminalInput, setTerminalInput] = useState<string>('')
  const [terminalLogs, setTerminalLogs] = useState<string[]>(INITIAL_TERMINAL_LOGS)

  const appendTerminalLogs = useCallback((...entries: string[]) => {
    setTerminalLogs((prev) => [...prev, ...entries].slice(-MAX_TERMINAL_LINES))
  }, [])

  const handleRunTerminalCommand = useCallback(
    async (cmdToRun?: string, timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS) => {
      const cmd = cmdToRun || terminalInput
      if (!cmd.trim() || !window.electronAPI) return

      appendTerminalLogs(`PS> ${cmd} (Executing... timeout: ${timeoutMs / 1000}s)`)
      if (!cmdToRun) setTerminalInput('')

      const res = await window.electronAPI.executePowerShellCommand(cmd, workspacePath || undefined, timeoutMs)
      const outStr = res.output || ''
      appendTerminalLogs(outStr, '')

      if (!res.success || MISSING_TOOL_PATTERNS.some((pattern) => outStr.includes(pattern))) {
        onCommandNotice(cmd, outStr)
      }

      return res
    },
    [terminalInput, workspacePath, appendTerminalLogs, onCommandNotice]
  )

  const handleClearTerminal = useCallback(() => {
    setTerminalLogs(['Windows PowerShell (Terminal Svuotato)', ''])
  }, [])

  return {
    terminalInput,
    setTerminalInput,
    terminalLogs,
    appendTerminalLogs,
    handleRunTerminalCommand,
    handleClearTerminal,
  }
}
