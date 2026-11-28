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
    expect(markdown).toContain('# SESSION_TRACKER\nformat: 2')
    expect(markdown).toContain('- [x] Built authentication endpoint')
    expect(markdown).toContain('- [!] OAuth refresh token expiration bug not fixed in this turn')

    const promptBlock = tracker.compilePromptBlock()
    expect(promptBlock).toContain('SESSION_TRACKER')
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

  it('reads old open-milestone notices as status rather than unresolved bugs', () => {
    const legacy = [
      '## 3. Unresolved Issues, Errors & Known Debt',
      '- [!] No explicit blocker was recorded, but 2 milestone(s) are still open — see section 4.',
      '## 4. Next Recommended Steps',
      '- [ ] m-2: Add tests',
      '## 5. Raw Agent Summary',
      '## 3. Unresolved Issues, Errors & Known Debt',
      '- [!] This belongs to the agent summary, not the tracker',
    ].join('\n')
    const data = SessionDebtTracker.parseTrackerMarkdown(legacy).getData()
    expect(data.unresolvedIssues).toEqual([])
    expect(data.nextSteps).toEqual(['m-2: Add tests'])
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
    expect(markdown).toContain('- [!] open_milestones: 2')
    expect(SessionDebtTracker.parseTrackerMarkdown(markdown).getData().unresolvedIssues).toEqual([])
  })

  it('leaves the unresolved section empty when nothing is open and nothing failed', () => {
    const tracker = new SessionDebtTracker({
      completedTasks: ['m-1: done'],
      unresolvedIssues: [],
      modifiedFiles: [],
      nextSteps: [],
    })

    expect(tracker.compileTrackerMarkdown()).toContain('## unresolved_issues\n\n## next_steps')
  })

  it('an explicit blocker still outranks the open-milestone note', () => {
    const tracker = new SessionDebtTracker({
      completedTasks: [],
      unresolvedIssues: ['m-4: build fails'],
      modifiedFiles: [],
      nextSteps: ['m-5: pending'],
    })

    const markdown = tracker.compileTrackerMarkdown()
    expect(markdown).toContain('- [!] m-4: build fails')
    expect(markdown).not.toContain('open_milestones:')
  })
})
