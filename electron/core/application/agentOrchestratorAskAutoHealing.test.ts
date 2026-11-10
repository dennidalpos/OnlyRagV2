import { describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../../../shared/types'
import { AgentProgressPolicy } from '../domain/agent/agentProgressPolicy'
import { EpisodicMemoryCompactor } from '../domain/agent/episodicMemoryCompactor'
import { type AskToolContext, handleAskTool } from './agentOrchestratorAskAutoHealing'

function askContext(question: string, overrides: Partial<AskToolContext> = {}): AskToolContext {
  return {
    parsedTool: { tool: 'ask', parameters: { question } },
    agentMode: 'auto',
    stepCount: 5,
    maxSteps: 40,
    sessionId: 'ask-test',
    settings: {} as AppSettings,
    hasRecentToolFailure: false,
    errorCountInHistory: 0,
    compiledHistoryBlock: '',
    progress: new AgentProgressPolicy(),
    guardEvents: [],
    episodicCompactor: new EpisodicMemoryCompactor(),
    emitLog: vi.fn(),
    emitDone: vi.fn(),
    persistCurrentState: vi.fn(async () => {}),
    finalizeSession: vi.fn(),
    closeApplicationRun: vi.fn(async () => ({ outcome: 'closed' as const, result: { success: false, summary: 'closed' } })),
    answerVersionQuestion: vi.fn(async () => '[AUTONOMOUS VERSION ANSWER: DO NOT ASK ABOUT VERSIONS]\n- react: declare "^19.1.0".'),
    ...overrides,
  }
}

describe('handleAskTool version questions', () => {
  it('answers a version question in AUTO from the registry and keeps the run going', async () => {
    const ctx = askContext('Which versions of react and vite should I use?')

    const outcome = await handleAskTool(ctx)

    expect(outcome).toEqual({ outcome: 'continue' })
    expect(ctx.answerVersionQuestion).toHaveBeenCalledWith('Which versions of react and vite should I use?')
    expect(ctx.closeApplicationRun).not.toHaveBeenCalled()
    expect(ctx.episodicCompactor.getRecentFullLogs().at(-1)?.output).toContain('[AUTONOMOUS VERSION ANSWER')
    expect(ctx.guardEvents.map((event) => event.guard)).toEqual(['ask_redirect'])
  })

  it('closes the run once the redirect budget is spent', async () => {
    const ctx = askContext('Which version of react should I use?')
    ctx.progress.tryAskRedirect()
    ctx.progress.tryAskRedirect()

    const outcome = await handleAskTool(ctx)

    expect(outcome.outcome).toBe('return')
    expect(ctx.answerVersionQuestion).not.toHaveBeenCalled()
    expect(ctx.closeApplicationRun).toHaveBeenCalledTimes(1)
  })

  it('leaves version questions to the user outside AUTO', async () => {
    const ctx = askContext('Which version of react should I use?', { agentMode: 'guided' })

    const outcome = await handleAskTool(ctx)

    expect(outcome.outcome).toBe('return')
    expect(ctx.answerVersionQuestion).not.toHaveBeenCalled()
    expect(ctx.emitDone).toHaveBeenCalledWith(true, 'Which version of react should I use?')
  })
})

describe('handleAskTool genuine blockers in AUTO', () => {
  it('hands a network question to the user even after a tool failure, instead of redirecting it', async () => {
    const ctx = askContext('Could you enable network access so I can install the dependencies?', { hasRecentToolFailure: true, errorCountInHistory: 2 })

    const outcome = await handleAskTool(ctx)

    expect(outcome.outcome).toBe('return')
    expect(ctx.closeApplicationRun).toHaveBeenCalledWith(expect.objectContaining({ reason: { key: 'reasonAskDecision' } }))
    expect(ctx.guardEvents).toEqual([])
  })

  it('treats a question right after a user denial as the way forward', async () => {
    const episodicCompactor = new EpisodicMemoryCompactor()
    episodicCompactor.recordStep({ step: 4, tool: 'run_command', status: 'BLOCKED', summary: 'User denied contextual approval' }, '[USER DENIED] ...')
    const ctx = askContext('How should I proceed?', { episodicCompactor, hasRecentToolFailure: true })

    const outcome = await handleAskTool(ctx)

    expect(outcome.outcome).toBe('return')
    expect(ctx.guardEvents).toEqual([])
  })

  it('still redirects a lazy what-next question after an ordinary failure', async () => {
    const ctx = askContext('What should I do next?', { hasRecentToolFailure: true })

    expect(await handleAskTool(ctx)).toEqual({ outcome: 'continue' })
    expect(ctx.guardEvents.map((event) => event.guard)).toEqual(['ask_redirect'])
  })
})
