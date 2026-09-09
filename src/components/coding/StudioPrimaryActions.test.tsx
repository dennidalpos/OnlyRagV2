import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentModeSelector } from './AgentModeSelector'
import { AgentSessionHeaderBar } from './AgentSessionHeaderBar'
import { CodingEditorTabBar } from './CodingEditorTabBar'

describe('Studio primary actions', () => {
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

  it('keeps Ask and Edit primary while Plan remains explicit', async () => {
    const setMode = vi.fn()
    await act(async () => root.render(<AgentModeSelector agentMode="ask" setAgentMode={setMode} />))

    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(2)
    expect(container.textContent).toContain('Chiedi')
    expect(container.textContent).toContain('Modifica')
    const plan = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Pianifica')!
    await act(async () => plan.click())
    expect(setMode).toHaveBeenCalledWith('plan')
  })

  it('switches the primary action with the keyboard', async () => {
    const setMode = vi.fn()
    await act(async () => root.render(<AgentModeSelector agentMode="ask" setAgentMode={setMode} />))

    const group = container.querySelector('[role="radiogroup"]')!
    await act(async () => group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))

    expect(setMode).toHaveBeenCalledWith('agent')
  })

  it('hides terminal and diagnostics until details are expanded', async () => {
    await act(async () =>
      root.render(
        <CodingEditorTabBar
          openFiles={[]}
          selectedFile={null}
          isSaved
          onOpenFile={vi.fn()}
          onCloseFile={vi.fn()}
          isDiffMode={false}
          setIsDiffMode={vi.fn()}
          onSaveFile={vi.fn()}
          activeTab="editor"
          onSelectTab={vi.fn()}
        />,
      ),
    )

    expect(container.textContent).not.toContain('Terminale')
    const details = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Dettagli')!
    await act(async () => details.click())
    expect(container.textContent).toContain('Terminale')
    expect(container.textContent).toContain('Diagnostica Log')
  })

  it('keeps current activity and Stop visible in the session header', async () => {
    await act(async () =>
      root.render(
        <AgentSessionHeaderBar
          workspacePath="C:/workspace"
          isExecuting
          currentStep={3}
          maxSteps={10}
          currentStatusText="Verifica in corso"
          onCancel={vi.fn()}
        />,
      ),
    )

    expect(container.textContent).toContain('Verifica in corso')
    expect(container.textContent).toContain('Step 3/10')
    expect(container.textContent).toContain('Arresta')
  })
})
