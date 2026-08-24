import { describe, expect, it } from 'vitest'
import { SessionDebtTracker, compileSessionStopSummary } from './sessionDebtTracker'

describe('SessionDebtTracker Domain Unit Tests', () => {
  it('should initialize empty debt tracker report', () => {
    const tracker = new SessionDebtTracker()
    const data = tracker.getData()
    expect(data.completedTasks).toEqual([])
    expect(data.unresolvedIssues).toEqual([])
    expect(tracker.compilePromptBlock()).toBe('')
  })

  it('should format markdown and compile prompt block with unresolved debt', () => {
    const tracker = new SessionDebtTracker({
      completedTasks: ['Built authentication endpoint'],
      unresolvedIssues: ['OAuth refresh token expiration bug not fixed in this turn'],
      modifiedFiles: ['src/auth.ts'],
      nextSteps: ['Add unit tests for refresh token'],
    })

    const markdown = tracker.compileTrackerMarkdown()
    expect(markdown).toContain('# SESSION TRACKER & UNRESOLVED DEBT REPORT')
    expect(markdown).toContain('- [x] Built authentication endpoint')
    expect(markdown).toContain('- [!] **BLOCKER/DEBT:** OAuth refresh token expiration bug not fixed in this turn')

    const promptBlock = tracker.compilePromptBlock()
    expect(promptBlock).toContain('PERSISTENT SESSION TRACKER')
    expect(promptBlock).toContain('OAuth refresh token expiration bug')
  })

  it('should emit no prompt block when only modified files are known, avoiding a bare heading', () => {
    const tracker = new SessionDebtTracker({ modifiedFiles: ['src/App.tsx'] })
    expect(tracker.compilePromptBlock()).toBe('')
  })

  it('should emit no prompt block for a tracker parsed off disk that lists only files', () => {
    const markdown = [
      '# SESSION TRACKER & UNRESOLVED DEBT REPORT',
      '*Last Updated:* 2026-08-23T00:50:13.110Z',
      '',
      '## 1. Functional Changes & Completed Tasks',
      '- No tasks completed yet.',
      '',
      '## 2. Modified & Created Files',
      '- `package.json`',
      '',
      '## 3. Unresolved Issues, Errors & Known Debt',
      '- None reported (all verified).',
    ].join('\n')

    const tracker = SessionDebtTracker.parseTrackerMarkdown(markdown)
    expect(tracker.getData().modifiedFiles).toEqual(['package.json'])
    expect(tracker.compilePromptBlock()).toBe('')
  })

  it('should parse markdown report back into structured object', () => {
    const rawMarkdown = `# SESSION TRACKER & UNRESOLVED DEBT REPORT
*Last Updated:* 2026-08-16T01:00:00.000Z

## 1. Functional Changes & Completed Tasks
- [x] Refactored LLM prompt presets

## 2. Modified & Created Files
- \`electron/core/domain/agent/promptPresets.ts\`

## 3. Unresolved Issues, Errors & Known Debt
- [!] **BLOCKER/DEBT:** Rate limit error on secondary API endpoint

## 4. Next Recommended Steps
- [ ] Add exponential backoff retry logic`

    const tracker = SessionDebtTracker.parseTrackerMarkdown(rawMarkdown)
    const data = tracker.getData()

    expect(data.completedTasks).toContain('Refactored LLM prompt presets')
    expect(data.modifiedFiles).toContain('electron/core/domain/agent/promptPresets.ts')
    expect(data.unresolvedIssues).toContain('Rate limit error on secondary API endpoint')
    expect(data.nextSteps).toContain('Add exponential backoff retry logic')
  })
})

describe('open work is reported as debt', () => {
  it('stops claiming "all verified" while milestones are still open', () => {
    const tracker = new SessionDebtTracker({
      completedTasks: ['m-2: Create vite.config.ts'],
      unresolvedIssues: [],
      modifiedFiles: ['src/App.tsx'],
      nextSteps: ['m-1: Create package.json', 'm-3: Create src/App.tsx'],
    })

    const markdown = tracker.compileTrackerMarkdown()
    expect(markdown).not.toContain('None reported (all verified)')
    expect(markdown).toContain('2 milestone(s) are still open')
  })

  it('still says all verified when nothing is open and nothing failed', () => {
    const tracker = new SessionDebtTracker({
      completedTasks: ['m-1: done'],
      unresolvedIssues: [],
      modifiedFiles: [],
      nextSteps: [],
    })

    expect(tracker.compileTrackerMarkdown()).toContain('None reported (all verified)')
  })

  it('an explicit blocker still outranks the open-milestone note', () => {
    const tracker = new SessionDebtTracker({
      completedTasks: [],
      unresolvedIssues: ['m-4: build fails'],
      modifiedFiles: [],
      nextSteps: ['m-5: pending'],
    })

    const markdown = tracker.compileTrackerMarkdown()
    expect(markdown).toContain('BLOCKER/DEBT:** m-4: build fails')
    expect(markdown).not.toContain('still open')
  })
})

describe('compileSessionStopSummary', () => {
  it('accounts for the run instead of repeating an instruction meant for the model', () => {
    const summary = compileSessionStopSummary({
      reason: 'No-mutation stagnation streak limit reached (12 read/inspect steps without file changes).',
      stepCount: 45,
      completed: ['m-2: Create vite.config.ts'],
      outstanding: ['m-1: Create package.json', 'm-3: Create src/App.tsx'],
      modifiedFiles: ['src/App.tsx', 'package.json'],
    })

    expect(summary).toContain('passo 45')
    expect(summary).toContain('stagnation streak limit reached')
    expect(summary).toContain('m-2: Create vite.config.ts')
    expect(summary).toContain('m-1: Create package.json')
    expect(summary).toContain('src/App.tsx')
    // The old summary was this sentence and nothing else.
    expect(summary).not.toContain('Forcing execution pause')
  })

  it('caps long lists so the report stays readable', () => {
    const summary = compileSessionStopSummary({
      reason: 'stuck',
      stepCount: 90,
      completed: [],
      outstanding: Array.from({ length: 15 }, (_, i) => `m-${i + 1}: task`),
      modifiedFiles: [],
    })

    expect(summary).toContain('…and 7 more')
  })

  it('says plainly when a run wrote nothing at all', () => {
    const summary = compileSessionStopSummary({
      reason: 'Repeated tool failure limit reached (5 consecutive failures).',
      stepCount: 12,
      completed: [],
      outstanding: ['m-1: Create package.json'],
      modifiedFiles: [],
    })

    expect(summary).toContain('Nessuna modifica')
  })
})
