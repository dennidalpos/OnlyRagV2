import { useState, useEffect, useRef, useCallback } from 'react'
import { AgentPlan, AppSettings, InterviewQuestion, PlanGenerationResult, UserInterviewAnswer } from '../types'
import { soundEffectsService } from '../services/soundEffectsService'
import { logger } from '../lib/logger'
import {
  composeInterviewDecisionPrompt,
  createAcceptedRecommendationAnswers,
} from '../../shared/domain/agent/interviewDecisionContext'
import { shouldRunPlanInterview } from '../../shared/domain/agent/planInterviewPolicy'
import { validateInterviewAnswers } from '../../shared/domain/agent/interviewValidation'

export type { AgentPlan } from '../types'

export async function resolveInterviewPrompt(
  originalPrompt: string,
  answers: UserInterviewAnswer[],
  enrichPrompt: ((prompt: string, interviewAnswers: UserInterviewAnswer[], questions: InterviewQuestion[]) => Promise<string>) | undefined,
  onEnrichmentFailure: (reason: unknown) => void,
  questions: InterviewQuestion[] = []
): Promise<string> {
  const losslessPrompt = composeInterviewDecisionPrompt(originalPrompt, answers)
  if (!enrichPrompt || answers.length === 0) return losslessPrompt

  try {
    const enriched = await enrichPrompt(originalPrompt, answers, questions)
    const preservesInputs = typeof enriched === 'string'
      && enriched.includes(originalPrompt)
      && answers.every((answer) => enriched.includes(answer.selectedOption))
    if (preservesInputs) return enriched
    onEnrichmentFailure(new Error('Enrichment result omitted the original request or an interview decision'))
  } catch (error) {
    onEnrichmentFailure(error)
  }
  return losslessPrompt
}

interface UsePlanApprovalOptions {
  settings?: AppSettings
  activeSessionId?: string
  workspacePath?: string | null
  /** Plan history of the active session, owned by the session history store. */
  sessionPlans: AgentPlan[]
  /** Applies an update to the active session's plan history (persisted with the session). */
  onSessionPlansChange: (updater: (prev: AgentPlan[]) => AgentPlan[]) => void
  /** Immediately persists the exact revision before any runtime state is seeded. */
  onPersistPlan: (plan: AgentPlan) => Promise<boolean>
  onPlanApproved: (plan: AgentPlan) => void
}

interface PlanFlowScope {
  token: number
  sessionId?: string
  workspacePath?: string | null
}

export function usePlanApproval({
  settings,
  activeSessionId,
  workspacePath,
  sessionPlans,
  onSessionPlansChange,
  onPersistPlan,
  onPlanApproved,
}: UsePlanApprovalOptions) {
  const [activePlanIndex, setActivePlanIndex] = useState<number>(0)
  const [isGeneratingPlan, setIsGeneratingPlan] = useState<boolean>(false)
  const [isApprovingPlan, setIsApprovingPlan] = useState<boolean>(false)

  // Pre-flight Clarification Interview state
  const [interviewQuestions, setInterviewQuestions] = useState<InterviewQuestion[]>([])
  const [isInterviewActive, setIsInterviewActive] = useState<boolean>(false)
  const [isAnalyzingInterview, setIsAnalyzingInterview] = useState<boolean>(false)
  const pendingFlowRef = useRef<{
    prompt: string
    targetModel?: string
    currentStep: number
    questions: InterviewQuestion[]
    scope: PlanFlowScope
  } | null>(null)
  const flowTokenRef = useRef(0)
  const mountedRef = useRef(true)
  const activeContextRef = useRef({ activeSessionId, workspacePath })
  activeContextRef.current = { activeSessionId, workspacePath }
  const approvalInFlightRef = useRef<Set<string>>(new Set())

  const planHistory = sessionPlans
  const currentPlan = planHistory[activePlanIndex] || (planHistory.length > 0 ? planHistory[planHistory.length - 1] : null)

  const updateCurrentSessionPlans = onSessionPlansChange

  // Read by generatePlan and by the session-change effect, which must see the history of
  // the session being left/entered without re-running on every plan mutation.
  const planHistoryRef = useRef<AgentPlan[]>(planHistory)
  useEffect(() => {
    planHistoryRef.current = planHistory
  }, [planHistory])

  useEffect(() => {
    // When the session changes, point at the latest plan version of that session.
    const list = planHistoryRef.current
    setActivePlanIndex(list.length > 0 ? list.length - 1 : 0)
  }, [activeSessionId])

  const beginFlowScope = useCallback((): PlanFlowScope => ({
    token: ++flowTokenRef.current,
    sessionId: activeContextRef.current.activeSessionId,
    workspacePath: activeContextRef.current.workspacePath,
  }), [])

  const isFlowCurrent = useCallback((scope: PlanFlowScope): boolean => {
    const context = activeContextRef.current
    return mountedRef.current
      && flowTokenRef.current === scope.token
      && context.activeSessionId === scope.sessionId
      && context.workspacePath === scope.workspacePath
  }, [])

  useEffect(() => {
    flowTokenRef.current += 1
    pendingFlowRef.current = null
    approvalInFlightRef.current.clear()
    setIsGeneratingPlan(false)
    setIsApprovingPlan(false)
    setIsAnalyzingInterview(false)
    setIsInterviewActive(false)
    setInterviewQuestions([])
  }, [activeSessionId, workspacePath])

  useEffect(() => () => {
    mountedRef.current = false
    flowTokenRef.current += 1
  }, [])

  const generatePlan = useCallback(
    async (
      prompt: string,
      targetModel?: string,
      currentStep: number = 0,
      interviewContext?: { originalPrompt: string; answers: UserInterviewAnswer[] },
      inheritedScope?: PlanFlowScope
    ): Promise<AgentPlan | null> => {
      const scope = inheritedScope || beginFlowScope()
      if (!isFlowCurrent(scope)) return null
      setIsGeneratingPlan(true)

      const planId = `plan_${Date.now()}_${scope.token}`
      const existingHistory = planHistoryRef.current
      const newVersion = existingHistory.length + 1

      const lastApprovedPlan = [...existingHistory].reverse().find((plan) => plan.status === 'approved')
      const previousDecisions = interviewContext?.answers?.length
        ? interviewContext.answers
        : [...existingHistory].reverse().find((plan) => plan.interviewAnswers?.length)?.interviewAnswers || []

      const initialPlan: AgentPlan = {
        formatVersion: 2,
        id: planId,
        version: newVersion,
        prompt,
        originalPrompt: interviewContext?.originalPrompt || prompt,
        interviewAnswers: interviewContext?.answers || [],
        objective: prompt,
        decisions: [],
        retainedEvidence: [],
        milestones: [],
        supersededWork: [],
        status: 'generating',
        createdAt: new Date().toISOString(),
        baseStepOffset: currentStep,
      }

      updateCurrentSessionPlans((prev) => [...prev, initialPlan])
      const newIdx = existingHistory.length
      setActivePlanIndex(newIdx)

      try {
        const modelToUse = targetModel || settings?.codingModel || settings?.defaultModel || 'qwen2.5-coder:7b'
        let generationError: string | undefined
        let generatedPlan: PlanGenerationResult | undefined

        if (window.electronAPI?.agentPlanGenerate && settings) {
          try {
            const genRes = await window.electronAPI.agentPlanGenerate(
              prompt,
              modelToUse,
              settings,
              lastApprovedPlan,
              scope.workspacePath,
              previousDecisions
            )
            if (!isFlowCurrent(scope)) return null
            generatedPlan = genRes
            if (genRes?.status === 'error') generationError = genRes.error || 'Pianificazione non completata'
          } catch (ipcErr: any) {
            if (!isFlowCurrent(scope)) return null
            logger.warn('usePlanApproval', `agentPlanGenerate IPC failed: ${ipcErr?.message}`)
            generationError = ipcErr?.message || 'IPC di pianificazione non disponibile'
          }
        } else {
          logger.warn('usePlanApproval', 'agentPlanGenerate not available: ensure Electron preload is loaded and settings are set.')
          generationError = 'Servizio di pianificazione non disponibile'
        }

        if (!generationError && !generatedPlan?.milestones.length) {
          generationError = 'Il pianificatore non ha restituito un piano eseguibile'
        }

        if (generationError) {
          const failedPlan: AgentPlan = {
            ...initialPlan,
            objective: generatedPlan?.objective || prompt,
            decisions: generatedPlan?.decisions || [],
            retainedEvidence: generatedPlan?.retainedEvidence || [],
            milestones: generatedPlan?.milestones || [],
            supersededWork: generatedPlan?.supersededWork || [],
            status: 'error',
            errorPhase: 'planning',
            errorMessage: generationError,
          }
          updateCurrentSessionPlans((prev) => {
            const copy = [...prev]
            copy[newIdx] = failedPlan
            return copy
          })
          setIsGeneratingPlan(false)
          return failedPlan
        }

        const finalPlan: AgentPlan = {
          formatVersion: 2,
          id: planId,
          version: newVersion,
          prompt,
          originalPrompt: interviewContext?.originalPrompt || prompt,
          interviewAnswers: interviewContext?.answers || [],
          objective: generatedPlan!.objective,
          decisions: generatedPlan!.decisions,
          retainedEvidence: generatedPlan!.retainedEvidence,
          supersededWork: generatedPlan!.supersededWork,
          status: 'ready',
          createdAt: new Date().toISOString(),
          baseStepOffset: currentStep,
          milestones: generatedPlan!.milestones,
        }

        updateCurrentSessionPlans((prev) => {
          const copy = [...prev]
          copy[newIdx] = finalPlan
          return copy
        })
        setIsGeneratingPlan(false)
        soundEffectsService.play('interactive', settings?.enableSoundEffects !== false)
        return finalPlan
      } catch (err: any) {
        if (!isFlowCurrent(scope)) return null
        logger.error('usePlanApproval', `Error generating plan: ${err?.message}`)
        const failedPlan: AgentPlan = {
          formatVersion: 2,
          id: planId,
          version: newVersion,
          prompt,
          originalPrompt: interviewContext?.originalPrompt || prompt,
          interviewAnswers: interviewContext?.answers || [],
          objective: prompt,
          decisions: [],
          retainedEvidence: [],
          milestones: [],
          supersededWork: [],
          status: 'error',
          createdAt: new Date().toISOString(),
          baseStepOffset: currentStep,
          errorPhase: 'planning',
          errorMessage: err?.message || 'Errore inatteso durante la pianificazione',
        }
        updateCurrentSessionPlans((prev) => {
          const copy = [...prev]
          copy[newIdx] = failedPlan
          return copy
        })
        setIsGeneratingPlan(false)
        return failedPlan
      }
    },
    [beginFlowScope, isFlowCurrent, settings, updateCurrentSessionPlans]
  )

  const replacePlanRevision = useCallback((revision: AgentPlan) => {
    updateCurrentSessionPlans((prev) => {
      const idx = prev.findIndex((plan) => plan.id === revision.id)
      if (idx < 0) return prev
      const copy = [...prev]
      copy[idx] = revision
      return copy
    })
  }, [updateCurrentSessionPlans])

  const handleApprovePlan = useCallback(async () => {
    const target = currentPlan
    if (!target || (target.status !== 'ready' && target.status !== 'approved')) return
    if (!activeSessionId || !target.milestones?.length || !window.electronAPI?.agentPlanSeed) return

    const approvalKey = `${activeSessionId}:${target.id}`
    if (approvalInFlightRef.current.has(approvalKey)) return
    approvalInFlightRef.current.add(approvalKey)
    const scope = beginFlowScope()
    setIsApprovingPlan(true)

    const approved: AgentPlan = { ...target, status: 'approved', approvalError: undefined }
    const recover = async (message: string) => {
      const recoverable: AgentPlan = { ...target, status: 'ready', approvalError: message }
      replacePlanRevision(recoverable)
      try {
        await onPersistPlan(recoverable)
      } catch (err: any) {
        logger.warn('usePlanApproval', `Could not persist approval recovery for ${target.id}: ${err?.message}`)
      }
    }

    try {
      let persisted = false
      try {
        persisted = await onPersistPlan(approved)
      } catch (err: any) {
        logger.warn('usePlanApproval', `Could not persist approved revision ${target.id}: ${err?.message}`)
      }
      if (!persisted) {
        replacePlanRevision({ ...target, status: 'ready', approvalError: 'Salvataggio della revisione non riuscito. Riprova.' })
        return
      }
      if (!isFlowCurrent(scope)) return

      let seeded = false
      try {
        seeded = await window.electronAPI.agentPlanSeed(
          activeSessionId,
          workspacePath ?? null,
          approved.milestones!,
          approved.prompt
        )
      } catch (err: any) {
        logger.warn('usePlanApproval', `agentPlanSeed IPC failed: ${err?.message}`)
        await recover(err?.message || 'Preparazione del piano per l\'agente non riuscita. Riprova.')
        return
      }

      if (!isFlowCurrent(scope)) return
      if (!seeded) {
        await recover('Preparazione del piano per l\'agente non riuscita. Riprova.')
        return
      }

      replacePlanRevision(approved)
      onPlanApproved(approved)
    } finally {
      approvalInFlightRef.current.delete(approvalKey)
      if (isFlowCurrent(scope)) setIsApprovingPlan(false)
    }
  }, [activeSessionId, beginFlowScope, currentPlan, isFlowCurrent, onPersistPlan, onPlanApproved, replacePlanRevision, workspacePath])

  const handleRejectPlan = useCallback(() => {
    if (!currentPlan) return
    updateCurrentSessionPlans((prev) => {
      const copy = [...prev]
      const idx = copy.findIndex((p) => p.id === currentPlan.id)
      if (idx >= 0) {
        copy[idx] = { ...copy[idx], status: 'cancelled' }
      }
      return copy
    })
  }, [currentPlan, updateCurrentSessionPlans])

  const selectPlanVersion = useCallback((idx: number) => {
    if (idx >= 0 && idx < planHistory.length) {
      setActivePlanIndex(idx)
    }
  }, [planHistory.length])

  const resetPlanHistory = useCallback(() => {
    flowTokenRef.current += 1
    updateCurrentSessionPlans(() => [])
    setActivePlanIndex(0)
  }, [updateCurrentSessionPlans])

  const startPlanFlow = useCallback(
    async (prompt: string, targetModel?: string, currentStep: number = 0): Promise<AgentPlan | null> => {
      const scope = beginFlowScope()
      updateCurrentSessionPlans((prev) => prev.map((plan) =>
        plan.status === 'generating' ? { ...plan, status: 'cancelled' } : plan
      ))
      setIsGeneratingPlan(false)
      setIsAnalyzingInterview(false)
      setIsInterviewActive(false)
      setInterviewQuestions([])
      pendingFlowRef.current = { prompt, targetModel, currentStep, questions: [], scope }

      const previousDecisions = [...planHistoryRef.current]
        .reverse()
        .find((plan) => plan.interviewAnswers?.length)?.interviewAnswers || []
      const needsInterview = shouldRunPlanInterview(prompt, previousDecisions)

      if (needsInterview && window.electronAPI?.agentPlanInterview && settings && settings.enablePrePlanInterview !== false) {
        setIsAnalyzingInterview(true)
        try {
          const modelToUse = targetModel || settings?.codingModel || settings?.defaultModel || 'qwen2.5-coder:7b'
          const interviewRes = await window.electronAPI.agentPlanInterview(
            prompt,
            modelToUse,
            settings,
            scope.workspacePath,
            previousDecisions,
          )
          if (!isFlowCurrent(scope)) return null
          setIsAnalyzingInterview(false)

          if (interviewRes?.status === 'error') {
            const failedPlan: AgentPlan = {
              formatVersion: 2,
              id: `plan_${Date.now()}_${scope.token}`,
              version: planHistoryRef.current.length + 1,
              prompt,
              originalPrompt: prompt,
              interviewAnswers: [],
              objective: prompt,
              decisions: [],
              retainedEvidence: [],
              milestones: [],
              supersededWork: [],
              status: 'error',
              createdAt: new Date().toISOString(),
              baseStepOffset: currentStep,
              errorPhase: 'interview',
              errorMessage: interviewRes.error || 'Intervista preliminare non completata',
            }
            updateCurrentSessionPlans((prev) => [...prev, failedPlan])
            setActivePlanIndex(planHistoryRef.current.length)
            return failedPlan
          }

          if (interviewRes?.status === 'cancelled') {
            const cancelledPlan: AgentPlan = {
              formatVersion: 2,
              id: `plan_${Date.now()}_${scope.token}`,
              version: planHistoryRef.current.length + 1,
              prompt,
              originalPrompt: prompt,
              interviewAnswers: [],
              objective: prompt,
              decisions: [],
              retainedEvidence: [],
              milestones: [],
              supersededWork: [],
              status: 'cancelled',
              createdAt: new Date().toISOString(),
              baseStepOffset: currentStep,
            }
            updateCurrentSessionPlans((prev) => [...prev, cancelledPlan])
            setActivePlanIndex(planHistoryRef.current.length)
            return cancelledPlan
          }

          if (interviewRes?.hasQuestions && interviewRes.questions && interviewRes.questions.length > 0) {
            pendingFlowRef.current = { prompt, targetModel, currentStep, questions: interviewRes.questions, scope }
            setInterviewQuestions(interviewRes.questions)
            setIsInterviewActive(true)
            soundEffectsService.play('interactive', settings?.enableSoundEffects !== false)
            return null
          }
        } catch (err: any) {
          if (!isFlowCurrent(scope)) return null
          logger.warn('usePlanApproval', `agentPlanInterview failed: ${err?.message}`)
          setIsAnalyzingInterview(false)
          const failedPlan: AgentPlan = {
            formatVersion: 2,
            id: `plan_${Date.now()}_${scope.token}`,
            version: planHistoryRef.current.length + 1,
            prompt,
            originalPrompt: prompt,
            interviewAnswers: [],
            objective: prompt,
            decisions: [],
            retainedEvidence: [],
            milestones: [],
            supersededWork: [],
            status: 'error',
            createdAt: new Date().toISOString(),
            baseStepOffset: currentStep,
            errorPhase: 'interview',
            errorMessage: err?.message || 'Intervista preliminare non disponibile',
          }
          updateCurrentSessionPlans((prev) => [...prev, failedPlan])
          setActivePlanIndex(planHistoryRef.current.length)
          return failedPlan
        }
      }

      setIsInterviewActive(false)
      setInterviewQuestions([])
      return generatePlan(prompt, targetModel, currentStep, { originalPrompt: prompt, answers: [] }, scope)
    },
    [beginFlowScope, generatePlan, isFlowCurrent, settings, updateCurrentSessionPlans]
  )

  const confirmInterviewAnswers = useCallback(
    async (answers: UserInterviewAnswer[]) => {
      const pending = pendingFlowRef.current
      if (!pending) return
      const validation = validateInterviewAnswers(pending.questions, answers)
      if (!validation.valid) {
        logger.warn('usePlanApproval', `Interview answers rejected: ${validation.error}`)
        return null
      }
      pendingFlowRef.current = null
      setIsInterviewActive(false)
      setInterviewQuestions([])
      setIsAnalyzingInterview(true)

      const effectivePrompt = await resolveInterviewPrompt(
        pending.prompt,
        validation.answers,
        window.electronAPI?.agentPlanEnrichPrompt,
        (err: any) => logger.warn('usePlanApproval', `agentPlanEnrichPrompt failed: ${err?.message || String(err)}`),
        pending.questions
      )
      if (!isFlowCurrent(pending.scope)) return null
      setIsAnalyzingInterview(false)

      return generatePlan(effectivePrompt, pending.targetModel, pending.currentStep, {
        originalPrompt: pending.prompt,
        answers: validation.answers,
      }, pending.scope)
    },
    [generatePlan, isFlowCurrent]
  )

  const skipInterviewWithRecommended = useCallback(() => {
    const pending = pendingFlowRef.current
    if (!pending) return
    return confirmInterviewAnswers(createAcceptedRecommendationAnswers(pending.questions))
  }, [confirmInterviewAnswers])

  const retryCurrentPlan = useCallback(() => {
    if (!currentPlan || currentPlan.status !== 'error') return
    const originalPrompt = currentPlan.originalPrompt || currentPlan.prompt
    if (currentPlan.errorPhase === 'interview') {
      return startPlanFlow(originalPrompt, undefined, currentPlan.baseStepOffset || 0)
    }
    return generatePlan(currentPlan.prompt, undefined, currentPlan.baseStepOffset || 0, {
      originalPrompt,
      answers: currentPlan.interviewAnswers || [],
    })
  }, [currentPlan, generatePlan, startPlanFlow])

  return {
    currentPlan,
    planHistory,
    activePlanIndex,
    isGeneratingPlan,
    isApprovingPlan,
    generatePlan,
    startPlanFlow,
    interviewQuestions,
    isInterviewActive,
    isAnalyzingInterview,
    confirmInterviewAnswers,
    skipInterviewWithRecommended,
    retryCurrentPlan,
    handleApprovePlan,
    handleRejectPlan,
    selectPlanVersion,
    resetPlanHistory,
  }
}
