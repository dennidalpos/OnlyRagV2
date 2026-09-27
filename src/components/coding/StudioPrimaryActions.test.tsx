import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentModeSelector } from './AgentModeSelector'
import { AgentSessionHeaderBar } from './AgentSessionHeaderBar'
import { CodingEditorTabBar } from './CodingEditorTabBar'
import { CodingHeader } from './CodingHeader'
import { PromptComposer } from './PromptComposer'
import { InlineDestructiveConfirm } from '../common/InlineDestructiveConfirm'

describe('Studio primary actions', () => {
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

  it('offers Ask, Guided, and Auto with Guided as the default workflow', async () => {
    const setMode = vi.fn()
    await act(async () => root.render(<AgentModeSelector agentMode="guided" setAgentMode={setMode} />))

    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(3)
    expect(container.textContent).toContain('Chiedi')
    expect(container.textContent).toContain('Guidata')
    expect(container.textContent).toContain('Auto')
  })

  it('switches the primary action with the keyboard', async () => {
    const setMode = vi.fn()
    await act(async () => root.render(<AgentModeSelector agentMode="ask" setAgentMode={setMode} />))

    const group = container.querySelector('[role="radiogroup"]')!
    await act(async () => group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))

    expect(setMode).toHaveBeenCalledWith('guided')
  })

  it('shows terminal directly and omits the removed diagnostics tab', async () => {
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

    expect(container.textContent).toContain('Terminale')
    expect(container.textContent).not.toContain('Dettagli')
    expect(container.textContent).not.toContain('Diagnostica Log')
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

  it('opens system diagnostics directly from OS Tools', async () => {
    const open = vi.fn()
    await act(async () => root.render(<CodingHeader guestOsInfo={null} activeModel="" onOpenDiagnosticsModal={open} />))
    const trigger = container.querySelector('button[aria-label="Stato Toolchain Host"]') as HTMLButtonElement
    expect(trigger).toBeTruthy()
    await act(async () => trigger.click())
    expect(open).toHaveBeenCalledOnce()
  })

  it('keeps Run direct and offers planning only in Guided and Auto', async () => {
    const execute = vi.fn()
    const plan = vi.fn()
    const renderComposer = (agentMode: 'ask' | 'guided' | 'auto') => (
      <PromptComposer
        agentPrompt="Refactor the module"
        setAgentPrompt={vi.fn()}
        onExecute={execute}
        onPlanTask={plan}
        isExecuting={false}
        queueLength={0}
        agentMode={agentMode}
        setAgentMode={vi.fn()}
        autoScroll
        onToggleAutoScroll={vi.fn()}
        hasPendingUnconsolidatedMilestones={false}
        ingestedDocs={[]}
        attachedDocIds={new Set()}
        onToggleAttachDoc={vi.fn()}
      />
    )
    await act(async () => root.render(renderComposer('guided')))
    const planButton = container.querySelector('button[aria-label="Pianifica"]') as HTMLButtonElement
    expect(planButton).toBeTruthy()
    await act(async () => planButton.click())
    expect(plan).toHaveBeenCalledOnce()
    expect(execute).not.toHaveBeenCalled()
    await act(async () => (container.querySelector('button[aria-label="Avvia Task"]') as HTMLButtonElement).click())
    expect(execute).toHaveBeenCalledOnce()
    await act(async () => root.render(renderComposer('ask')))
    expect(container.querySelector('button[aria-label="Pianifica"]')).toBeNull()
    await act(async () => root.render(renderComposer('auto')))
    expect(container.querySelector('button[aria-label="Pianifica"]')).toBeTruthy()
  })

  it('places delete confirmation outside the clipped sidebar', async () => {
    const remove = vi.fn()
    await act(async () => root.render(<InlineDestructiveConfirm itemLabel="project" hint="Remove the project reference" onConfirm={remove} />))
    await act(async () => (container.querySelector('button') as HTMLButtonElement).click())
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog).toBeTruthy()
    expect(container.contains(dialog)).toBe(false)
    expect(dialog.textContent).toContain('Remove the project reference')
  })
})
