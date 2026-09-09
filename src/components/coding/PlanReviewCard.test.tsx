import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentPlan } from '../../types'
import { PlanReviewCard, preparePlanReviewRevision } from './PlanReviewCard'

const plan: AgentPlan = {
  formatVersion: 2,
  id: 'plan-1',
  version: 1,
  prompt: 'Crea la pagina',
  objective: 'Pagina pronta per gli utenti',
  decisions: [
    { id: 'd-1', statement: 'Usa la route esistente', source: 'explicit_user' },
    { id: 'd-2', statement: 'Mantieni il tema scuro', source: 'assumption' },
  ],
  retainedEvidence: [],
  supersededWork: [],
  status: 'ready',
  createdAt: '2026-09-09T00:00:00.000Z',
  milestones: [
    {
      id: 'm-1',
      title: 'Crea la pagina',
      status: 'pending',
      filePaths: ['src/Page.tsx'],
      verificationCommand: 'npm run typecheck',
    },
  ],
}

describe('PlanReviewCard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('shows confirmed decisions and assumptions before the plan editor', async () => {
    await act(async () => root.render(<PlanReviewCard plan={plan} onSave={vi.fn()} />))

    expect(container.textContent).toContain('Decisioni confermate')
    expect(container.textContent).toContain('Usa la route esistente')
    expect(container.textContent).toContain('Assunzioni')
    expect(container.textContent).toContain('Mantieni il tema scuro')
  })

  it('prepares validated result, file, and check edits', () => {
    const prepared = preparePlanReviewRevision(plan, '  Pagina accessibile e verificata  ', [
      {
        ...plan.milestones[0],
        title: '  Aggiorna la pagina  ',
        filePaths: ['src/Page.tsx', 'src/Page.test.tsx'],
        verificationCommand: '  npm test  ',
      },
    ])

    expect(prepared.revision).toMatchObject({
      objective: 'Pagina accessibile e verificata',
      milestones: [
        expect.objectContaining({
          title: 'Aggiorna la pagina',
          filePaths: ['src/Page.tsx', 'src/Page.test.tsx'],
          verificationCommand: 'npm test',
        }),
      ],
    })
  })

  it('blocks workspace-escaping file paths before saving', () => {
    const prepared = preparePlanReviewRevision(plan, plan.objective, [
      {
        ...plan.milestones[0],
        filePaths: ['../outside.ts'],
      },
    ])

    expect(prepared.error).toContain('percorsi relativi')
    expect(prepared.revision).toBeUndefined()
  })
})
