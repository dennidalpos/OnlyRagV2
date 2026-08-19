import { resolveSessionContext } from './agentOrchestratorSessionContext'
import { initializeSessionState } from './agentOrchestratorSessionState'
import { buildSessionPersistence } from './agentOrchestratorSessionPersistence'
import { armSessionWatchdog } from './agentOrchestratorSessionWatchdog'
import type { BootstrapParams, AgentSessionBootstrap } from './agentOrchestratorBootstrapTypes'

export type { BootstrapParams, AgentSessionBootstrap } from './agentOrchestratorBootstrapTypes'

/**
 * One-shot per-session setup for runAgentOrchestratorLoop: resolves the task/workspace/
 * settings context, initializes the loop-scoped state machines and restores any saved
 * session, builds the persistence/reporting closures, and arms the session timeout
 * watchdog. See agentOrchestratorSessionContext/State/Persistence/Watchdog.ts for the four
 * steps this composes.
 */
export async function bootstrapAgentSession(params: BootstrapParams): Promise<AgentSessionBootstrap> {
  const { payload, session, sessionId, isSessionActive, deregisterSession } = params

  const emitLog: AgentSessionBootstrap['emitLog'] = (type, message, detail) => {
    if (isSessionActive() && session.targetWindow && !session.targetWindow.isDestroyed()) {
      session.targetWindow.webContents.send('agent:log', {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        timestamp: new Date().toISOString(),
        type,
        message,
        detail,
      })
    }
  }

  const emitDone = (success: boolean, summary: string) => {
    if (isSessionActive() && session.targetWindow && !session.targetWindow.isDestroyed()) {
      session.targetWindow.webContents.send('agent:done', { success, summary })
    }
  }

  const context = await resolveSessionContext({ payload, session, sessionId, emitLog })

  const state = await initializeSessionState({
    payload,
    sessionId,
    workspacePath: context.workspacePath,
    agentMode: context.agentMode,
    userTask: context.userTask,
    settings: context.settings,
    emitLog,
  })

  const persistence = buildSessionPersistence({
    sessionId,
    workspacePath: context.workspacePath,
    agentMode: context.agentMode,
    userTask: context.userTask,
    initialUserTask: state.initialUserTask,
    MAX_STEPS: state.MAX_STEPS,
    maxStepsLabel: state.maxStepsLabel,
    settings: context.settings,
    stepCountBox: state.stepCountBox,
    sessionChangedFiles: state.sessionChangedFiles,
    goalPlanner: state.goalPlanner,
    episodicCompactor: state.episodicCompactor,
    session,
    isSessionActive,
  })

  const watchdog = armSessionWatchdog({
    session,
    sessionId,
    settings: context.settings,
    emitLog,
    emitDone,
    persistCurrentState: persistence.persistCurrentState,
    stepCountBox: state.stepCountBox,
    isSessionActive,
    deregisterSession,
  })

  return {
    ...context,
    ...state,
    ...persistence,
    ...watchdog,
    emitLog,
    emitDone,
  }
}
