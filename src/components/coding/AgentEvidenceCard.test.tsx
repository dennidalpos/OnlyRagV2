import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ExecutedPrompt } from '../../types'
import { AgentEvidenceCard } from './AgentEvidenceCard'

describe('AgentEvidenceCard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('shows changed files, verification, cancellation, and non-rollback effects', async () => {
    const prompt: ExecutedPrompt = {
      id: 'p1',
      sessionId: 's1',
      prompt: 'Ship it',
      startedAt: '2026-09-21T10:00:00.000Z',
      completedAt: '2026-09-21T10:05:00.000Z',
      agentMode: 'auto',
      outcome: 'cancelled',
      completionStatus: 'cancelled',
      totalSteps: 3,
      filesTouched: 1,
      additions: 4,
      deletions: 1,
      evidence: {
        changedFiles: ['src/app.ts'],
        verification: {
          status: 'failed',
          checkedAt: '2026-09-21T10:04:00.000Z',
          command: 'npm test',
        },
        cancellationStatus: 'residual_effects',
        rollbackRestoredFiles: 1,
        nonRollbackEffects: ['run_command: npm install'],
      },
    }

    await act(async () => root.render(<AgentEvidenceCard prompt={prompt} />))

    expect(container.textContent).toContain('Evidenze finali')
    expect(container.textContent).toContain('src/app.ts')
    expect(container.textContent).toContain('npm test')
    expect(container.textContent).toContain('Residui da controllare')
    expect(container.textContent).toContain('run_command: npm install')
  })
})
