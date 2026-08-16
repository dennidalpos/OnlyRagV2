import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { AppSettings } from '../types'
import { logger } from '../lib/logger'

export interface AgentPlan {
  id: string
  version: number
  prompt: string
  planText: string
  status: 'idle' | 'generating' | 'ready' | 'approved' | 'rejected'
  createdAt: string
  baseStepOffset?: number
}

const PLANS_STORAGE_KEY = 'onlyrag_session_plans_v1'

function loadSavedSessionPlans(): Record<string, AgentPlan[]> {
  try {
    const raw = localStorage.getItem(PLANS_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch (err: any) {
    logger.warn('usePlanApproval', `Could not parse saved session plans: ${err?.message}`)
    return {}
  }
}

function saveSavedSessionPlans(plansMap: Record<string, AgentPlan[]>) {
  try {
    localStorage.setItem(PLANS_STORAGE_KEY, JSON.stringify(plansMap))
  } catch (err: any) {
    logger.warn('usePlanApproval', `Could not save session plans: ${err?.message}`)
  }
}

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

interface UsePlanApprovalOptions {
  settings?: AppSettings
  activeSessionId?: string
  onPlanApproved: (plan: AgentPlan) => void
}

export function usePlanApproval({ settings, activeSessionId, onPlanApproved }: UsePlanApprovalOptions) {
  const sessionKey = activeSessionId || 'default_session'
  const [plansBySession, setPlansBySession] = useState<Record<string, AgentPlan[]>>(() => loadSavedSessionPlans())
  const [activePlanIndex, setActivePlanIndex] = useState<number>(0)
  const [isGeneratingPlan, setIsGeneratingPlan] = useState<boolean>(false)
  const [countdownSeconds, setCountdownSeconds] = useState<number>(15)
  const [isAutoProceedPaused, setIsAutoProceedPaused] = useState<boolean>(false)

  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const requireApproval = settings?.requirePlanApproval ?? true
  const autoProceed = settings?.autoProceedPlan ?? true
  const autoProceedDelay = settings?.autoProceedDelaySeconds ?? 15

  const planHistory = plansBySession[sessionKey] || []
  const currentPlan = planHistory[activePlanIndex] || (planHistory.length > 0 ? planHistory[planHistory.length - 1] : null)

  const updateCurrentSessionPlans = useCallback(
    (updater: (prev: AgentPlan[]) => AgentPlan[]) => {
      setPlansBySession((prev) => {
        const currentList = prev[sessionKey] || []
        const updatedList = updater(currentList)
        const nextMap = { ...prev, [sessionKey]: updatedList }
        saveSavedSessionPlans(nextMap)
        return nextMap
      })
    },
    [sessionKey]
  )

  useEffect(() => {
    // When session changes, set active plan index to latest version in that session
    const list = plansBySession[sessionKey] || []
    if (list.length > 0) {
      setActivePlanIndex(list.length - 1)
    } else {
      setActivePlanIndex(0)
    }
  }, [sessionKey])

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
      const existingHistory = plansBySession[sessionKey] || []
      const newVersion = existingHistory.length + 1

      const initialPlan: AgentPlan = {
        id: planId,
        version: newVersion,
        prompt,
        planText: 'Generazione piano in corso...',
        status: 'generating',
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        baseStepOffset: currentStep,
      }

      updateCurrentSessionPlans((prev) => [...prev, initialPlan])
      const newIdx = existingHistory.length
      setActivePlanIndex(newIdx)

      try {
        const modelToUse = targetModel || settings?.codingModel || settings?.defaultModel || 'qwen2.5-coder:7b'
        const systemPrompt = `Sei un AI Coding Assistant. Analizza la richiesta dell'utente e genera un Piano di Implementazione breve, strutturato e chiaro (max 4-6 punti). Usa emoji per demarcare le fasi (es. 🎯 Obiettivo, 🔍 Analisi, ✏️ Modifiche, 🧪 Verifica).`

        const host = settings?.ollamaHost || 'http://127.0.0.1:11434'
        let accumulatedPlan = ''

        try {
          const response = await fetch(`${host}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: modelToUse,
              system: systemPrompt,
              prompt: `Genera un piano d'azione sintetico per il seguente task:\n\n${prompt}`,
              stream: false,
            }),
          })
          if (response.ok) {
            const data = await response.json()
            accumulatedPlan = data.response?.trim() || ''
          }
        } catch (fetchErr: any) {
          logger.warn('usePlanApproval', `Ollama generate fetch failed: ${fetchErr?.message}`)
        }

        if (!accumulatedPlan) {
          accumulatedPlan = `🎯 Piano di Esecuzione (v${newVersion}) per: ${prompt}\n\n1. 🔍 Analisi del contesto del progetto e identificazione dei file rilevanti\n2. ✏️ Implementazione delle modifiche richieste e refactoring atomico\n3. 🧪 Verifica di correttezza tramite build e controlli di tipo`
        }

        // Ensure mandatory final stop directive
        accumulatedPlan = ensureMandatoryStopDirective(accumulatedPlan)

        const finalPlan: AgentPlan = {
          id: planId,
          version: newVersion,
          prompt,
          planText: accumulatedPlan,
          status: 'ready',
          createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          baseStepOffset: currentStep,
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
        const fallbackPlan: AgentPlan = {
          id: planId,
          version: newVersion,
          prompt,
          planText: ensureMandatoryStopDirective(fallbackRaw),
          status: 'ready',
          createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          baseStepOffset: currentStep,
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
    [sessionKey, plansBySession, settings?.codingModel, settings?.defaultModel, autoProceedDelay, clearPlanTimer, updateCurrentSessionPlans]
  )

  const handleApprovePlan = useCallback(() => {
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
    onPlanApproved(approved)
  }, [currentPlan, clearPlanTimer, onPlanApproved, updateCurrentSessionPlans])

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

  const handleUpdatePlanText = useCallback((newText: string) => {
    if (!currentPlan) return
    const formatted = ensureMandatoryStopDirective(newText)
    updateCurrentSessionPlans((prev) => {
      const copy = [...prev]
      const idx = copy.findIndex((p) => p.id === currentPlan.id)
      if (idx >= 0) {
        copy[idx] = { ...copy[idx], planText: formatted }
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
