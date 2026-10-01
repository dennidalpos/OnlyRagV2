import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentApprovalRequest, AgentPlan, UserInterviewAnswer } from '../../shared/types'
import type { RendererEventSink } from '../../electron/core/domain/ports/rendererEventSink'
import { createAgentRunIdentity } from '../../shared/domain/agent/agentRunIdentity'
import { shouldRunPlanInterview } from '../../shared/domain/agent/planInterviewPolicy'
import { agentInterviewAppService } from '../../electron/core/application/agentInterviewAppService'
import { planGenerationAppService } from '../../electron/core/application/planGenerationAppService'
import { respondToApproval, runAgentOrchestratorLoop } from '../../electron/core/application/agentOrchestratorAppService'
import { agentSessionStateRepository } from '../../electron/core/infrastructure/filesystem/agentSessionStateRepository'
import { managedDevServerRepository } from '../../electron/core/infrastructure/process/managedDevServerRepository'
import { verifyWebUi } from '../../electron/core/infrastructure/process/webUiSmokeVerifier'
import { readRunMetrics, snapshotLiveAuditLogs } from './agentLiveHarness'
import { createQwen35Campaign, QWEN35_MODEL } from './qwen35Campaign'
import { TASKLAB_PROMPT_VERSION, TASKLAB_STAGES, type TaskLabFeature } from './taskLabPrompts'
import { checkTaskLabCommand, verifyTaskLab } from './taskLabVerification'

const requestedRun = process.env.ONLYRAG_TASKLAB_RUN
if (requestedRun && !['1', '2'].includes(requestedRun)) throw new Error('ONLYRAG_TASKLAB_RUN must be 1 or 2.')
const runs = requestedRun ? [Number(requestedRun)] : [1, 2]

describe.each(runs)('live: TaskLab independent sequence %i', () => {
  let campaign: Awaited<ReturnType<typeof createQwen35Campaign>>
  let workspace: string
  let conversation: string
  let previousPlan: AgentPlan | undefined
  let answers: UserInterviewAnswer[] = []
  const features = new Set<TaskLabFeature>()
  let nextStage = 0
  const results: Array<{ stage: string; passed: boolean; error?: string }> = []

  function save(name: string, value: unknown, root = campaign.root) {
    fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2), 'utf8')
  }

  beforeAll(async () => {
    campaign = await createQwen35Campaign('tasklab-9b-thinking', {
      temperature: 1,
      top_p: 0.95,
      top_k: 20,
      min_p: 0,
      presence_penalty: 1.5,
      repeat_penalty: 1,
    })
    workspace = path.join(campaign.root, 'workspace')
    fs.mkdirSync(workspace)
    conversation = `tasklab-${randomUUID()}`
    save('prompts.json', { version: TASKLAB_PROMPT_VERSION, stages: TASKLAB_STAGES })
    save('consent.json', { fixture: 'User-authorized local project dependency installation and workspace edits; host installs and Git commits denied.' })
  })

  afterAll(async () => {
    managedDevServerRepository.stopAll()
    if (campaign) {
      save('sequence.json', {
        version: TASKLAB_PROMPT_VERSION,
        conversation,
        workspace,
        requiredStages: TASKLAB_STAGES.map((stage) => stage.id),
        results,
        qualified: results.length === TASKLAB_STAGES.length && results.every((result) => result.passed),
      })
      await campaign.close()
    }
  })

  for (const [index, stage] of TASKLAB_STAGES.entries()) {
    it(`${stage.id}: ${stage.feature}`, async () => {
      // Do not silently proceed after an earlier stage failed, even without Vitest --bail.
      expect(nextStage, 'A prerequisite stage failed; preserve its workspace and diagnose before a fresh sequence.').toBe(index)
      const root = path.join(campaign.root, stage.id)
      fs.mkdirSync(root)
      const identity = createAgentRunIdentity({
        conversationId: conversation,
        workspacePath: workspace,
        planRevisionId: `revision-${index + 1}-${randomUUID()}`,
      })
      const events: Array<{ channel: string; payload: unknown }> = []
      const sink: RendererEventSink = {
        isAvailable: () => true,
        send(channel, payload) {
          events.push({ channel, payload })
          if (channel !== 'agent:approval-request') return
          const request = payload as AgentApprovalRequest
          const approved =
            request.type !== 'git_commit' &&
            Boolean(request.reasons?.length) &&
            request.reasons!.every((reason) => ['network_access', 'workspace_mutation', 'guided_review'].includes(reason))
          save('events.json', events, root)
          expect(respondToApproval(request, approved)).toBe(true)
        },
      }
      let phase = 'interview'
      let effectivePrompt: string = stage.prompt
      try {
        save('input.json', { identity, prompt: stage.prompt, priorPlan: previousPlan || null, answers }, root)
        if (stage.feature === 'resumed') {
          const restored = await agentSessionStateRepository.loadSessionState(conversation, workspace)
          save('restored-session.json', restored, root)
          expect(restored?.status).toBe('COMPLETED')
          expect(restored?.chatMessages?.length).toBeGreaterThan(0)
          // Restore the approved plan and interview from disk rather than relying on harness memory.
          previousPlan = JSON.parse(fs.readFileSync(path.join(campaign.root, TASKLAB_STAGES[index - 1].id, 'verified-plan.json'), 'utf8')) as AgentPlan
          answers = previousPlan.interviewAnswers || []
          expect(previousPlan?.decisions.some((decision) => decision.source === 'explicit_user' && /localStorage/i.test(decision.statement))).toBe(true)
          expect(previousPlan.milestones.every((milestone) => milestone.status === 'verified')).toBe(true)
          save('restored-plan.json', previousPlan, root)
        }
        if (shouldRunPlanInterview(stage.prompt, answers)) {
          const interview = await agentInterviewAppService.conductInterview(stage.prompt, QWEN35_MODEL, campaign.settings, workspace, answers, identity.runId)
          save('interview.json', interview, root)
          expect(interview.status, interview.error).not.toBe('error')
          expect(interview.status).not.toBe('cancelled')
          const currentAnswers = interview.questions.map((question): UserInterviewAnswer => {
            const storage = stage.feature === 'persistence' && question.options.some((option) => /localStorage/i.test(option))
            return {
              questionId: question.id,
              questionText: question.question,
              selectedOption: storage
                ? 'localStorage; browser-only persistence; no backend or external connections.'
                : question.options[question.recommendedIndex],
              provenance: storage ? 'explicit' : 'accepted_recommendation',
              isCustom: storage,
            }
          })
          if (stage.feature === 'persistence')
            expect(currentAnswers.some((answer) => answer.provenance === 'explicit' && /localStorage/i.test(answer.selectedOption))).toBe(true)
          effectivePrompt = agentInterviewAppService.enrichPromptWithAnswers(stage.prompt, currentAnswers, interview.questions)
          answers = [...answers, ...currentAnswers]
          save('answers.json', currentAnswers, root)
        }
        phase = 'planning'
        save('progress.json', { phase }, root)
        const generated = await planGenerationAppService.generatePlanText({
          operationId: identity.runId,
          prompt: effectivePrompt,
          model: QWEN35_MODEL,
          settings: campaign.settings,
          workspacePath: workspace,
          previousPlan,
          previousDecisions: answers,
        })
        save('generated-plan.json', generated, root)
        expect(generated.status, generated.error).toBe('success')
        expect(generated.milestones.length).toBeGreaterThan(0)
        if (previousPlan) expect(generated.retainedEvidence.length).toBeGreaterThan(0)
        const plan: AgentPlan = {
          ...generated,
          formatVersion: 2,
          id: identity.planRevisionId,
          version: index + 1,
          prompt: effectivePrompt,
          originalPrompt: stage.prompt,
          interviewAnswers: answers,
          status: 'approved',
          createdAt: new Date().toISOString(),
        }
        save('approved-plan.json', plan, root)
        expect(await agentSessionStateRepository.seedPlanMilestones(conversation, workspace, plan.milestones, effectivePrompt, identity.planRevisionId)).toBe(
          true,
        )
        phase = 'execution'
        save('progress.json', { phase }, root)
        const result = await runAgentOrchestratorLoop(
          {
            identity,
            sessionId: conversation,
            userTask: effectivePrompt,
            workspacePath: workspace,
            agentMode: 'auto',
            settings: campaign.settings,
            forceContextCompaction: stage.feature === 'resumed',
          },
          sink,
        )
        save('execution.json', result, root)
        save('events.json', events, root)
        const metrics = readRunMetrics({ workspacePath: workspace, sessionId: conversation, success: result.success, summary: result.summary })
        save('metrics.json', metrics, root)
        save('session.json', await agentSessionStateRepository.loadSessionState(conversation, workspace), root)
        expect(result.success, result.error || result.summary).toBe(true)
        expect(result.completionStatus).toBe('verified')
        expect(metrics.milestones.length).toBeGreaterThan(0)
        expect(metrics.verifiedRatio).toBe(1)
        phase = 'independent-verification'
        save('progress.json', { phase }, root)
        await checkTaskLabCommand(workspace, root, 'test')
        await checkTaskLabCommand(workspace, root, 'build')
        features.add(stage.feature)
        const allMilestones = [...(previousPlan?.milestones || []), ...metrics.milestones]
        const smoke = await verifyWebUi(workspace, allMilestones)
        save('native-browser-smoke.json', smoke, root)
        expect(smoke.status, smoke.detail).toBe('passed')
        await verifyTaskLab(workspace, root, features)
        previousPlan = { ...plan, milestones: metrics.milestones }
        save('verified-plan.json', previousPlan, root)
        results.push({ stage: stage.id, passed: true })
        nextStage++
        save('progress.json', { phase: 'verified' }, root)
      } catch (error) {
        results.push({ stage: stage.id, passed: false, error: error instanceof Error ? error.message : String(error) })
        save('progress.json', { phase, status: 'failed', error: results.at(-1)?.error }, root)
        throw error
      } finally {
        snapshotLiveAuditLogs({ sessionId: conversation, label: stage.id, destinationRoot: path.join(root, 'audit') })
        if (managedDevServerRepository.runningPort(workspace)) managedDevServerRepository.stop(workspace)
      }
    })
  }
})
