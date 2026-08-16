import { describe, expect, it } from 'vitest'
import { SessionDebtTracker } from './sessionDebtTracker'

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
