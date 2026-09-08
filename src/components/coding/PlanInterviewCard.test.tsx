import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanInterviewCard } from './PlanInterviewCard'

describe('PlanInterviewCard', () => {
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

  it('does not treat the displayed recommendation as confirmation', async () => {
    const onConfirm = vi.fn()
    await act(async () => root.render(<PlanInterviewCard
      questions={[{
        id: 'storage',
        question: 'Quale persistenza preferisci?',
        rationale: 'La scelta cambia portabilità e gestione dei dati.',
        options: ['SQLite', 'File JSON'],
        recommendedIndex: 0,
      }]}
      onConfirm={onConfirm}
      onSkipWithRecommended={vi.fn()}
    />))

    const confirm = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Conferma e Genera Piano'))!
    expect(confirm.disabled).toBe(true)

    const recommended = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('SQLite'))!
    await act(async () => recommended.click())
    expect(confirm.disabled).toBe(false)
  })
})
