import { useCallback } from 'react'
import { useAgentTerminal } from '../useAgentTerminal'
import type { AgentActionLogApi } from './useAgentActionLog'

export interface UseCodingAgentTerminalOptions {
  workspacePath: string | null
  addActionLog: AgentActionLogApi['addActionLog']
}

/** Interactive terminal of the Coding Agent Studio; failing commands are also reported in the action log. */
export function useCodingAgentTerminal({ workspacePath, addActionLog }: UseCodingAgentTerminalOptions) {
  const handleCommandNotice = useCallback(
    (command: string, output: string) => {
      addActionLog(
        'terminal',
        `Command execution notice for "${command}":`,
        `Command output indicates tool or executable is not installed on Windows PATH or exited with error.\n${output.slice(0, 300)}`,
      )
    },
    [addActionLog],
  )

  return useAgentTerminal({ workspacePath, onCommandNotice: handleCommandNotice })
}
