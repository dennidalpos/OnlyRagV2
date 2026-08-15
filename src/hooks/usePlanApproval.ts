import { useState, useEffect, useRef, useCallback } from 'react'
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

interface UsePlanApprovalOptions {
  settings?: AppSettings
  onPlanApproved: (plan: AgentPlan) => void
}

export function usePlanApproval({ settings, onPlanApproved }: UsePlanApprovalOptions) {
  const [planHistory, setPlanHistory] = useState<AgentPlan[]>([])
  const [activePlanIndex, setActivePlanIndex] = useState<number>(0)
  const [isGeneratingPlan, setIsGeneratingPlan] = useState<boolean>(false)
  const [countdownSeconds, setCountdownSeconds] = useState<number>(15)
  const [isAutoProceedPaused, setIsAutoProceedPaused] = useState<boolean>(false)

  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const requireApproval = settings?.requirePlanApproval ?? true
  const autoProceed = settings?.autoProceedPlan ?? true
  const autoProceedDelay = settings?.autoProceedDelaySeconds ?? 15

  const currentPlan = planHistory[activePlanIndex] || null

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
      const newVersion = planHistory.length + 1

      const initialPlan: AgentPlan = {
        id: planId,
        version: newVersion,
        prompt,
        planText: 'Generazione piano in corso...',
        status: 'generating',
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        baseStepOffset: currentStep,
      }

      setPlanHistory((prev) => [...prev, initialPlan])
      const newIdx = planHistory.length
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

        const finalPlan: AgentPlan = {
          id: planId,
          version: newVersion,
          prompt,
          planText: accumulatedPlan,
          status: 'ready',
          createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          baseStepOffset: currentStep,
        }

        setPlanHistory((prev) => {
          const copy = [...prev]
          copy[newIdx] = finalPlan
          return copy
        })
        setIsGeneratingPlan(false)
        return finalPlan
      } catch (err: any) {
        logger.error('usePlanApproval', `Error generating plan: ${err?.message}`)
        const fallbackPlan: AgentPlan = {
          id: planId,
          version: newVersion,
          prompt,
          planText: `🎯 Piano di Esecuzione (v${newVersion}) per: ${prompt}\n1. 🔍 Analisi del contesto e dei file del workspace\n2. ✏️ Esecuzione delle modifiche richieste\n3. 🧪 Verifica dei risultati`,
          status: 'ready',
          createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          baseStepOffset: currentStep,
        }
        setPlanHistory((prev) => {
          const copy = [...prev]
          copy[newIdx] = fallbackPlan
          return copy
        })
        setIsGeneratingPlan(false)
        return fallbackPlan
      }
    },
    [planHistory.length, settings?.codingModel, settings?.defaultModel, autoProceedDelay, clearPlanTimer]
  )

  const handleApprovePlan = useCallback(() => {
    clearPlanTimer()
    if (!currentPlan) return
    const approved: AgentPlan = { ...currentPlan, status: 'approved' }
    setPlanHistory((prev) => {
      const copy = [...prev]
      if (copy[activePlanIndex]) {
        copy[activePlanIndex] = approved
      }
      return copy
    })
    onPlanApproved(approved)
  }, [currentPlan, activePlanIndex, clearPlanTimer, onPlanApproved])

  const handleRejectPlan = useCallback(() => {
    clearPlanTimer()
    if (!currentPlan) return
    setPlanHistory((prev) => {
      const copy = [...prev]
      if (copy[activePlanIndex]) {
        copy[activePlanIndex] = { ...copy[activePlanIndex], status: 'rejected' }
      }
      return copy
    })
  }, [activePlanIndex, clearPlanTimer])

  const handleUpdatePlanText = useCallback((newText: string) => {
    setPlanHistory((prev) => {
      const copy = [...prev]
      if (copy[activePlanIndex]) {
        copy[activePlanIndex] = { ...copy[activePlanIndex], planText: newText }
      }
      return copy
    })
  }, [activePlanIndex])

  const selectPlanVersion = useCallback((idx: number) => {
    if (idx >= 0 && idx < planHistory.length) {
      setActivePlanIndex(idx)
    }
  }, [planHistory.length])

  const resetPlanHistory = useCallback(() => {
    clearPlanTimer()
    setPlanHistory([])
    setActivePlanIndex(0)
  }, [clearPlanTimer])

  const hasApprovedPlan = planHistory.some((p) => p.status === 'approved')

  return {
    currentPlan,
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
