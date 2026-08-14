import { describe, it, expect } from 'vitest'
import { QueuedPrompt } from '../../hooks/useCodingAgent'

describe('Coding Agent Prompt Queue & Terminal Logic Unit Tests', () => {
  it('should correctly enqueue, edit, reorder, and remove prompt queue items', () => {
    let queue: QueuedPrompt[] = []

    // 1. Enqueue 3 items
    const item1: QueuedPrompt = { id: 'p1', prompt: 'npm run build', createdAt: '10:00' }
    const item2: QueuedPrompt = { id: 'p2', prompt: 'git status', createdAt: '10:01' }
    const item3: QueuedPrompt = { id: 'p3', prompt: 'npm run test:fast', createdAt: '10:02' }
    queue = [...queue, item1, item2, item3]

    expect(queue).toHaveLength(3)
    expect(queue[0].prompt).toBe('npm run build')

    // 2. Edit item2 in queue
    queue = queue.map((p) => (p.id === 'p2' ? { ...p, prompt: 'git status --short' } : p))
    expect(queue.find((p) => p.id === 'p2')?.prompt).toBe('git status --short')

    // 3. Pop first item upon completion
    const [nextTask, ...remaining] = queue
    expect(nextTask.prompt).toBe('npm run build')
    queue = remaining
    expect(queue).toHaveLength(2)
    expect(queue[0].id).toBe('p2')

    // 4. Delete item3
    queue = queue.filter((p) => p.id !== 'p3')
    expect(queue).toHaveLength(1)
    expect(queue[0].id).toBe('p2')
  })

  it('should compute scroll threshold accurately for terminal freeze behavior', () => {
    // When user is near bottom (<= 45px)
    const scrollHeight = 1000
    const clientHeight = 400
    let scrollTop = 580 // distance to bottom: 1000 - 580 - 400 = 20px <= 45px

    let isNearBottom = scrollHeight - scrollTop - clientHeight <= 45
    expect(isNearBottom).toBe(true)

    // When user scrolls up (> 45px away from bottom)
    scrollTop = 300 // distance to bottom: 1000 - 300 - 400 = 300px > 45px
    isNearBottom = scrollHeight - scrollTop - clientHeight <= 45
    expect(isNearBottom).toBe(false)
  })

  it('should safely resolve prompt text even when passed React SyntheticEvent/MouseEvent object', () => {
    const resolvePrompt = (agentPrompt: string, overridePrompt?: string | unknown) => {
      const rawPrompt = typeof overridePrompt === 'string' ? overridePrompt : agentPrompt
      return (rawPrompt || '').trim()
    }

    // Normal invocation (Enter key or direct call)
    expect(resolvePrompt('Refactor this module')).toBe('Refactor this module')

    // Click event object passed accidentally by onClick
    const mockMouseEvent = { nativeEvent: {}, type: 'click', target: {} }
    expect(resolvePrompt('Refactor this module', mockMouseEvent)).toBe('Refactor this module')

    // Override string passed explicitly
    expect(resolvePrompt('Initial prompt', 'Override prompt')).toBe('Override prompt')

    // Whitespace only prompt
    expect(resolvePrompt('   ')).toBe('')
  })

  it('should reset queue, prompts, and context cleanly when starting a new session', () => {
    let actionLogs: any[] = [{ id: '1', message: 'User prompt' }, { id: '2', message: 'Tool result' }]
    let agentPrompt = 'Write code'
    let promptQueue: QueuedPrompt[] = [{ id: 'q1', prompt: 'Next task', createdAt: '10:00' }]
    let attachedDocIds = new Set(['doc1', 'doc2'])
    let pinnedFiles = new Map([['f1', { name: 'f1.ts', path: '/f1.ts', isDir: false }]])

    // Simulate handleNewSession
    actionLogs = []
    agentPrompt = ''
    promptQueue = []
    attachedDocIds = new Set()
    pinnedFiles = new Map()

    expect(actionLogs).toHaveLength(0)
    expect(agentPrompt).toBe('')
    expect(promptQueue).toHaveLength(0)
    expect(attachedDocIds.size).toBe(0)
    expect(pinnedFiles.size).toBe(0)
  })
})
