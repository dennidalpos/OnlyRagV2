import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { AgentPlan, AppSettings, PlanMilestone, InterviewQuestion, UserInterviewAnswer } from '../types'
import { soundEffectsService } from '../services/soundEffectsService'
import { logger } from '../lib/logger'
import {
  composeInterviewDecisionPrompt,
  createAcceptedRecommendationAnswers,
} from '../../shared/domain/agent/interviewDecisionContext'

export type { AgentPlan } from '../types'

export const MANDATORY_PLAN_STOP_ITEM = '🛑 Completamento dell\'ultimo task, riepilogo finale e arresto dell\'agente (invoke "finish")'

export function ensureMandatoryStopDirective(planText: string): string {
  if (!planText || typeof planText !== 'string') return planText
  if (
    planText.includes('Completamento dell\'ultimo task') ||
    planText.includes('arresto dell\'agente') ||
    planText.includes('invoke "finish"')
  ) {
    return planText
  }

  const lines = planText.split(/\r?\n/)
  const matches = planText.match(/^(\d+)[\.\)]/gm)
  let nextNum = 1
  if (matches && matches.length > 0) {
    const lastNumStr = matches[matches.length - 1].replace(/[^\d]/g, '')
    const parsed = parseInt(lastNumStr, 10)
    if (!isNaN(parsed)) nextNum = parsed + 1
  } else {
    nextNum = lines.filter((l) => l.trim().length > 0).length + 1
  }

  const stopDirective = `${nextNum}. ${MANDATORY_PLAN_STOP_ITEM}`
  return `${planText.trim()}\n${stopDirective}`
}

export async function resolveInterviewPrompt(
  originalPrompt: string,
  answers: UserInterviewAnswer[],
  enrichPrompt: ((prompt: string, interviewAnswers: UserInterviewAnswer[]) => Promise<string>) | undefined,
  onEnrichmentFailure: (reason: unknown) => void
): Promise<string> {
  const losslessPrompt = composeInterviewDecisionPrompt(originalPrompt, answers)
  if (!enrichPrompt || answers.length === 0) return losslessPrompt

  try {
    const enriched = await enrichPrompt(originalPrompt, answers)
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

/**
 * Parses plan text into canonical milestones via the backend's
 * GoalDecompositionPlanner parser (the same one the orchestrator loop uses),
 * instead of re-implementing checklist/numbered-list regex parsing here.
 * Returns undefined (not an empty array) when the IPC is unavailable, so
 * callers can distinguish "no canonical data" from "parsed to zero items"
 * and fall back to local heuristics accordingly.
 */
async function parsePlanTextToMilestones(planText: string): Promise<PlanMilestone[] | undefined> {
  if (!window.electronAPI?.agentPlanParseText) return undefined
  try {
    return await window.electronAPI.agentPlanParseText(planText)
  } catch (err: any) {
    logger.warn('usePlanApproval', `agentPlanParseText IPC failed: ${err?.message}`)
    return undefined
  }
}

interface UsePlanApprovalOptions {
  settings?: AppSettings
  activeSessionId?: string
  workspacePath?: string | null
  /** Plan history of the active session, owned by the session history store. */
  sessionPlans: AgentPlan[]
  /** Applies an update to the active session's plan history (persisted with the session). */
  onSessionPlansChange: (updater: (prev: AgentPlan[]) => AgentPlan[]) => void
  onPlanApproved: (plan: AgentPlan) => void
}

export function usePlanApproval({
  settings,
  activeSessionId,
  workspacePath,
  sessionPlans,
  onSessionPlansChange,
  onPlanApproved,
}: UsePlanApprovalOptions) {
  const [activePlanIndex, setActivePlanIndex] = useState<number>(0)
  const [isGeneratingPlan, setIsGeneratingPlan] = useState<boolean>(false)
  const [countdownSeconds, setCountdownSeconds] = useState<number>(15)
  const [isAutoProceedPaused, setIsAutoProceedPaused] = useState<boolean>(false)

  // Pre-flight Clarification Interview state
  const [interviewQuestions, setInterviewQuestions] = useState<InterviewQuestion[]>([])
  const [isInterviewActive, setIsInterviewActive] = useState<boolean>(false)
  const [isAnalyzingInterview, setIsAnalyzingInterview] = useState<boolean>(false)
  const pendingFlowRef = useRef<{
    prompt: string
    targetModel?: string
    currentStep: number
    questions: InterviewQuestion[]
  } | null>(null)

  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const requireApproval = settings?.requirePlanApproval ?? true
  const autoProceed = settings?.autoProceedPlan ?? true
  const autoProceedDelay = settings?.autoProceedDelaySeconds ?? 15

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

  const handleApprovePlanRef = useRef<(() => Promise<void>) | null>(null)

  const clearPlanTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // Auto-proceed countdown effect
  useEffect(() => {
    const isReady = currentPlan && currentPlan.status === 'ready' && autoProceed && !isAutoProceedPaused
    if (!isReady) {
      clearPlanTimer()
      return
    }

    clearPlanTimer()
    timerRef.current = setInterval(() => {
      setCountdownSeconds((prev) => {
        if (prev <= 1) {
          clearPlanTimer()
          handleApprovePlanRef.current?.()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearPlanTimer()
  }, [currentPlan?.status, currentPlan?.id, autoProceed, isAutoProceedPaused, clearPlanTimer])

  const generatePlan = useCallback(
    async (
      prompt: string,
      targetModel?: string,
      currentStep: number = 0,
      interviewContext?: { originalPrompt: string; answers: UserInterviewAnswer[] }
    ): Promise<AgentPlan> => {
      clearPlanTimer()
      setIsAutoProceedPaused(false)
      setCountdownSeconds(autoProceedDelay)
      setIsGeneratingPlan(true)

      const planId = `plan_${Date.now()}`
      const existingHistory = planHistoryRef.current
      const newVersion = existingHistory.length + 1

      // C7: fold non-verified milestones from the most recent approved plan into
      // the generation request as reconciliation context, so the new plan absorbs
      // prior residual work instead of restarting from zero.
      const lastApprovedPlan = [...existingHistory].reverse().find((p) => p.status === 'approved' && p.milestones && p.milestones.length > 0)
      const pendingResidueMilestones = lastApprovedPlan?.milestones?.filter((m) => m.status !== 'verified')

      const initialPlan: AgentPlan = {
        id: planId,
        version: newVersion,
        prompt,
        originalPrompt: interviewContext?.originalPrompt || prompt,
        interviewAnswers: interviewContext?.answers || [],
        planText: 'Generazione piano in corso...',
        status: 'generating',
        createdAt: new Date().toISOString(),
        baseStepOffset: currentStep,
      }

      updateCurrentSessionPlans((prev) => [...prev, initialPlan])
      const newIdx = existingHistory.length
      setActivePlanIndex(newIdx)

      try {
        const modelToUse = targetModel || settings?.codingModel || settings?.defaultModel || 'qwen2.5-coder:7b'
        let accumulatedPlan = ''
        let generationError: string | undefined
        let generatedMilestones: PlanMilestone[] | undefined

        if (window.electronAPI?.agentPlanGenerate && settings) {
          try {
            const genRes = await window.electronAPI.agentPlanGenerate(prompt, modelToUse, settings, pendingResidueMilestones, workspacePath)
            accumulatedPlan = genRes?.planText?.trim() || ''
            generatedMilestones = genRes?.milestones
            if (genRes?.status === 'error') generationError = genRes.error || 'Pianificazione non completata'
          } catch (ipcErr: any) {
            logger.warn('usePlanApproval', `agentPlanGenerate IPC failed: ${ipcErr?.message}`)
            generationError = ipcErr?.message || 'IPC di pianificazione non disponibile'
          }
        } else {
          logger.warn('usePlanApproval', 'agentPlanGenerate not available: ensure Electron preload is loaded and settings are set.')
          generationError = 'Servizio di pianificazione non disponibile'
        }

        if (!generationError && !accumulatedPlan) {
          generationError = 'Il pianificatore ha restituito una risposta vuota'
        }

        if (generationError) {
          const failedPlan: AgentPlan = {
            ...initialPlan,
            planText: accumulatedPlan,
            status: 'error',
            milestones: generatedMilestones,
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

        // Ensure mandatory final stop directive
        accumulatedPlan = ensureMandatoryStopDirective(accumulatedPlan)

        // Re-parse the FINAL text (including the appended stop directive) through the
        // same canonical backend parser, so milestones match exactly what is displayed.
        const milestones = await parsePlanTextToMilestones(accumulatedPlan)

        const finalPlan: AgentPlan = {
          id: planId,
          version: newVersion,
          prompt,
          originalPrompt: interviewContext?.originalPrompt || prompt,
          interviewAnswers: interviewContext?.answers || [],
          planText: accumulatedPlan,
          status: 'ready',
          createdAt: new Date().toISOString(),
          baseStepOffset: currentStep,
          milestones,
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
        logger.error('usePlanApproval', `Error generating plan: ${err?.message}`)
        const failedPlan: AgentPlan = {
          id: planId,
          version: newVersion,
          prompt,
          originalPrompt: interviewContext?.originalPrompt || prompt,
          interviewAnswers: interviewContext?.answers || [],
          planText: '',
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
    [settings?.codingModel, settings?.defaultModel, autoProceedDelay, clearPlanTimer, updateCurrentSessionPlans, workspacePath]
  )

  const handleApprovePlan = useCallback(async () => {
    clearPlanTimer()
    if (!currentPlan || currentPlan.status !== 'ready') return
    const approved: AgentPlan = { ...currentPlan, status: 'approved' }
    updateCurrentSessionPlans((prev) => {
      const copy = [...prev]
      const idx = copy.findIndex((p) => p.id === currentPlan.id)
      if (idx >= 0) {
        copy[idx] = approved
      }
      return copy
    })

    // Seed the approved milestones into backend session state BEFORE execution
    // starts, so GoalDecompositionPlanner restores them as its starting state
    // instead of only auto-detecting a (possibly different) plan from the
    // model's first turn (see agentSessionStateRepository.seedPlanMilestones).
    if (activeSessionId && approved.milestones && approved.milestones.length > 0 && window.electronAPI?.agentPlanSeed) {
      try {
        await window.electronAPI.agentPlanSeed(activeSessionId, workspacePath ?? null, approved.milestones, approved.prompt)
      } catch (err: any) {
        logger.warn('usePlanApproval', `agentPlanSeed IPC failed: ${err?.message}`)
      }
    }

    onPlanApproved(approved)
  }, [currentPlan, clearPlanTimer, onPlanApproved, updateCurrentSessionPlans, activeSessionId, workspacePath])
  handleApprovePlanRef.current = handleApprovePlan

  const handleRejectPlan = useCallback(() => {
    clearPlanTimer()
    if (!currentPlan) return
    updateCurrentSessionPlans((prev) => {
      const copy = [...prev]
      const idx = copy.findIndex((p) => p.id === currentPlan.id)
      if (idx >= 0) {
        copy[idx] = { ...copy[idx], status: 'cancelled' }
      }
      return copy
    })
  }, [currentPlan, clearPlanTimer, updateCurrentSessionPlans])

  const handleUpdatePlanText = useCallback(async (newText: string) => {
    if (!currentPlan) return
    const formatted = ensureMandatoryStopDirective(newText)
    // Re-derive canonical milestones so a manual edit doesn't leave stale
    // milestones behind (see parsePlanTextToMilestones / C4 unified parser).
    const milestones = await parsePlanTextToMilestones(formatted)
    updateCurrentSessionPlans((prev) => {
      const copy = [...prev]
      const idx = copy.findIndex((p) => p.id === currentPlan.id)
      if (idx >= 0) {
        copy[idx] = { ...copy[idx], planText: formatted, milestones }
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
    clearPlanTimer()
    updateCurrentSessionPlans(() => [])
    setActivePlanIndex(0)
  }, [clearPlanTimer, updateCurrentSessionPlans])

  const latestActivePlan = useMemo(() => {
    if (planHistory.length === 0) return null
    const approved = [...planHistory].reverse().find((p) => p.status === 'approved')
    return approved || planHistory[planHistory.length - 1] || null
  }, [planHistory])

  const hasApprovedPlan = planHistory.some((p) => p.status === 'approved')

  const startPlanFlow = useCallback(
    async (prompt: string, targetModel?: string, currentStep: number = 0): Promise<AgentPlan | null> => {
      clearPlanTimer()
      setIsAutoProceedPaused(false)
      pendingFlowRef.current = { prompt, targetModel, currentStep, questions: [] }

      // Check if pre-flight interview is supported and enabled
      if (window.electronAPI?.agentPlanInterview && settings && settings.enablePrePlanInterview !== false) {
        setIsAnalyzingInterview(true)
        try {
          const modelToUse = targetModel || settings?.codingModel || settings?.defaultModel || 'qwen2.5-coder:7b'
          const interviewRes = await window.electronAPI.agentPlanInterview(prompt, modelToUse, settings)
          setIsAnalyzingInterview(false)

          if (interviewRes?.status === 'error') {
            const failedPlan: AgentPlan = {
              id: `plan_${Date.now()}`,
              version: planHistoryRef.current.length + 1,
              prompt,
              originalPrompt: prompt,
              interviewAnswers: [],
              planText: interviewRes.rawResponse?.trim() || '',
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
              id: `plan_${Date.now()}`,
              version: planHistoryRef.current.length + 1,
              prompt,
              originalPrompt: prompt,
              interviewAnswers: [],
              planText: interviewRes.rawResponse?.trim() || '',
              status: 'cancelled',
              createdAt: new Date().toISOString(),
              baseStepOffset: currentStep,
            }
            updateCurrentSessionPlans((prev) => [...prev, cancelledPlan])
            setActivePlanIndex(planHistoryRef.current.length)
            return cancelledPlan
          }

          if (interviewRes?.hasQuestions && interviewRes.questions && interviewRes.questions.length > 0) {
            pendingFlowRef.current = { prompt, targetModel, currentStep, questions: interviewRes.questions }
            setInterviewQuestions(interviewRes.questions)
            setIsInterviewActive(true)
            soundEffectsService.play('interactive', settings?.enableSoundEffects !== false)
            return null
          }
        } catch (err: any) {
          logger.warn('usePlanApproval', `agentPlanInterview failed: ${err?.message}`)
          setIsAnalyzingInterview(false)
          const failedPlan: AgentPlan = {
            id: `plan_${Date.now()}`,
            version: planHistoryRef.current.length + 1,
            prompt,
            originalPrompt: prompt,
            interviewAnswers: [],
            planText: '',
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
      return generatePlan(prompt, targetModel, currentStep, { originalPrompt: prompt, answers: [] })
    },
    [clearPlanTimer, generatePlan, settings]
  )

  const confirmInterviewAnswers = useCallback(
    async (answers: UserInterviewAnswer[]) => {
      setIsInterviewActive(false)
      setInterviewQuestions([])
      const pending = pendingFlowRef.current
      if (!pending) return

      const effectivePrompt = await resolveInterviewPrompt(
        pending.prompt,
        answers,
        window.electronAPI?.agentPlanEnrichPrompt,
        (err: any) => logger.warn('usePlanApproval', `agentPlanEnrichPrompt failed: ${err?.message || String(err)}`)
      )

      return generatePlan(effectivePrompt, pending.targetModel, pending.currentStep, {
        originalPrompt: pending.prompt,
        answers,
      })
    },
    [generatePlan]
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
    latestActivePlan,
    planHistory,
    activePlanIndex,
    hasApprovedPlan,
    isGeneratingPlan,
    countdownSeconds,
    isAutoProceedPaused,
    setIsAutoProceedPaused,
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
    handleUpdatePlanText,
    selectPlanVersion,
    resetPlanHistory,
    requireApproval,
    autoProceed,
  }
}
