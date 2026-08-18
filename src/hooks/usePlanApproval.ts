import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { AgentPlan, AppSettings, PlanMilestone } from '../types'
import { logger } from '../lib/logger'

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

  const clearPlanTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // Auto-proceed countdown effect
  useEffect(() => {
    if (
      currentPlan &&
      currentPlan.status === 'ready' &&
      autoProceed &&
      !isAutoProceedPaused &&
      countdownSeconds > 0
    ) {
      clearPlanTimer()
      timerRef.current = setInterval(() => {
        setCountdownSeconds((prev) => {
          if (prev <= 1) {
            clearPlanTimer()
            handleApprovePlan()
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }

    return () => clearPlanTimer()
  }, [currentPlan?.status, currentPlan?.id, autoProceed, isAutoProceedPaused, countdownSeconds])

  const generatePlan = useCallback(
    async (prompt: string, targetModel?: string, currentStep: number = 0): Promise<AgentPlan> => {
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

        if (window.electronAPI?.agentPlanGenerate && settings) {
          try {
            const genRes = await window.electronAPI.agentPlanGenerate(prompt, modelToUse, settings, pendingResidueMilestones)
            accumulatedPlan = genRes?.planText?.trim() || ''
          } catch (ipcErr: any) {
            logger.warn('usePlanApproval', `agentPlanGenerate IPC failed: ${ipcErr?.message}`)
          }
        } else {
          logger.warn('usePlanApproval', 'agentPlanGenerate not available: ensure Electron preload is loaded and settings are set.')
        }

        if (!accumulatedPlan) {
          accumulatedPlan = `🎯 Piano di Esecuzione (v${newVersion}) per: ${prompt}\n\n1. 🔍 Analisi del contesto del progetto e identificazione dei file rilevanti\n2. ✏️ Implementazione delle modifiche richieste e refactoring atomico\n3. 🧪 Verifica di correttezza tramite build e controlli di tipo`
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
        return finalPlan
      } catch (err: any) {
        logger.error('usePlanApproval', `Error generating plan: ${err?.message}`)
        const fallbackRaw = `🎯 Piano di Esecuzione (v${newVersion}) per: ${prompt}\n1. 🔍 Analisi del contesto e dei file del workspace\n2. ✏️ Esecuzione delle modifiche richieste\n3. 🧪 Verifica dei risultati`
        const fallbackText = ensureMandatoryStopDirective(fallbackRaw)
        const fallbackPlan: AgentPlan = {
          id: planId,
          version: newVersion,
          prompt,
          planText: fallbackText,
          status: 'ready',
          createdAt: new Date().toISOString(),
          baseStepOffset: currentStep,
          milestones: await parsePlanTextToMilestones(fallbackText),
        }
        updateCurrentSessionPlans((prev) => {
          const copy = [...prev]
          copy[newIdx] = fallbackPlan
          return copy
        })
        setIsGeneratingPlan(false)
        return fallbackPlan
      }
    },
    [settings?.codingModel, settings?.defaultModel, autoProceedDelay, clearPlanTimer, updateCurrentSessionPlans]
  )

  const handleApprovePlan = useCallback(async () => {
    clearPlanTimer()
    if (!currentPlan) return
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

  const handleRejectPlan = useCallback(() => {
    clearPlanTimer()
    if (!currentPlan) return
    updateCurrentSessionPlans((prev) => {
      const copy = [...prev]
      const idx = copy.findIndex((p) => p.id === currentPlan.id)
      if (idx >= 0) {
        copy[idx] = { ...copy[idx], status: 'rejected' }
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
    handleApprovePlan,
    handleRejectPlan,
    handleUpdatePlanText,
    selectPlanVersion,
    resetPlanHistory,
    requireApproval,
    autoProceed,
  }
}
