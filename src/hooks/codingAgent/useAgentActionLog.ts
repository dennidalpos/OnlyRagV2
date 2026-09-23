import { useCallback, useState } from 'react'
import type { AgentActionLog } from '../../types'

/** Visible timeline of the active Coding Agent conversation; every other coding hook reports through `addActionLog`. */
export function useAgentActionLog() {
  const [actionLogs, setActionLogs] = useState<AgentActionLog[]>([])

  const addActionLog = useCallback((type: AgentActionLog['type'], message: string, detail?: string, meta?: Partial<AgentActionLog>) => {
    setActionLogs((prev) => [
      ...prev,
      {
        id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        type,
        message,
        detail,
        timestamp: new Date().toLocaleTimeString(),
        ...meta,
      },
    ])
  }, [])

  return { actionLogs, setActionLogs, addActionLog }
}

export type AgentActionLogApi = ReturnType<typeof useAgentActionLog>
