import { describe, it, expect } from 'vitest'
import { ensureMandatoryStopDirective, MANDATORY_PLAN_STOP_ITEM } from './usePlanApproval'

describe('usePlanApproval & Plan Refactoring Unit Tests', () => {
  it('should automatically append mandatory stop directive to generated plan text', () => {
    const rawPlan = `🎯 Piano di Esecuzione v1
1. 🔍 Analisi dei file sorgenti
2. ✏️ Implementazione del refactoring`

    const formatted = ensureMandatoryStopDirective(rawPlan)
    expect(formatted).toContain(MANDATORY_PLAN_STOP_ITEM)
    expect(formatted).toContain('3. 🛑 Completamento dell\'ultimo task, riepilogo finale e arresto dell\'agente (invoke "finish")')
  })

  it('should not duplicate mandatory stop directive if already present in plan text', () => {
    const planWithStop = `🎯 Piano di Esecuzione v1
1. 🔍 Analisi dei file sorgenti
2. 🛑 Completamento dell'ultimo task, riepilogo finale e arresto dell'agente (invoke "finish")`

    const formatted = ensureMandatoryStopDirective(planWithStop)
    const matches = formatted.match(/Completamento dell'ultimo task/g)
    expect(matches).toHaveLength(1)
  })
})
