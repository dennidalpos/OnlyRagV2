import { describe, it, expect } from 'vitest'
import { HeuristicContextCompactor } from './heuristicContextCompactor'

const FAKE_SYSTEM_PROMPT = 'You are an AI coding assistant operating in AGENT mode.'
const FAKE_PLAN = '## Execution Checklist\n- [ ] **Task 1: Implement feature**\n  - **Files:** `src/feature.ts`'

function makeRepeated(str: string, count: number): string {
  return str.repeat(count)
}

describe('HeuristicContextCompactor', () => {
  it('should return prompt unchanged when under watermark', () => {
    const result = HeuristicContextCompactor.compile(
      {
        systemPrompt: FAKE_SYSTEM_PROMPT,
        activePlanBlock: FAKE_PLAN,
        pinnedFilesBlock: 'Some short pinned content',
        activeFileBlock: 'const x = 1',
        skillsBlock: '',
        historyBlock: '',
        attachedContext: '',
        projectMapBlock: '',
      },
      100_000
    )
    expect(result.wasCompacted).toBe(false)
    expect(result.finalChars).toBe(result.originalChars)
  })

  it('should trigger compaction and reduce prompt when over 75% watermark', () => {
    const hugePinnedFiles = makeRepeated('const longCode = "some very long variable initialization";\n', 500)
    const hugeHistory = makeRepeated('| Step X | read_file | src/foo.ts | SUCCESS | Loaded file |\n', 200)
    const hugeMap = makeRepeated('[FILE] src/components/something.tsx\n', 400)
    const hugeAttached = makeRepeated('Document chunk content about legal cases...\n', 300)

    const result = HeuristicContextCompactor.compile(
      {
        systemPrompt: FAKE_SYSTEM_PROMPT,
        activePlanBlock: FAKE_PLAN,
        pinnedFilesBlock: hugePinnedFiles,
        activeFileBlock: 'const x = 1',
        skillsBlock: '',
        historyBlock: hugeHistory,
        attachedContext: hugeAttached,
        projectMapBlock: hugeMap,
      },
      20_000
    )

    expect(result.wasCompacted).toBe(true)
    expect(result.finalChars).toBeLessThan(result.originalChars)
    expect(result.finalChars).toBeLessThanOrEqual(Math.floor(20_000 * 0.75))
    // Immutable segments must always be preserved fully
    expect(result.prompt).toContain(FAKE_SYSTEM_PROMPT)
    expect(result.prompt).toContain(FAKE_PLAN)
  })

  it('should always preserve immutable anchors even under extreme pressure', () => {
    const extreme = makeRepeated('A very long string to inflate the context size drastically.\n', 2000)
    const result = HeuristicContextCompactor.compile(
      {
        systemPrompt: FAKE_SYSTEM_PROMPT,
        activePlanBlock: FAKE_PLAN,
        pinnedFilesBlock: extreme,
        activeFileBlock: extreme,
        skillsBlock: extreme,
        historyBlock: extreme,
        attachedContext: extreme,
        projectMapBlock: extreme,
      },
      8_000
    )
    expect(result.wasCompacted).toBe(true)
    expect(result.prompt).toContain(FAKE_SYSTEM_PROMPT)
    expect(result.prompt).toContain(FAKE_PLAN)
  })

  it('should never zero the history allocation when the immutable tier overflows the budget (regression: agent repeated its first tool call forever)', () => {
    // Reproduces session-1787441347002-hu1s: an oversized immutable tier drove `remaining`
    // negative, flooring historyAlloc at 0. The history vanished, every turn's prompt became
    // byte-identical, and qwen2.5-coder:7b re-emitted the same `npm create vite` call 22 times.
    const history = [
      '### COMPLETE EXECUTION TRAJECTORY (Step History):',
      '| Step | Tool | Target | Status | Outcome Summary |',
      '|:---:|:---|:---|:---:|:---|',
      '| Step 1 | `run_command` | npm create vite | SUCCESS | scaffolded |',
      '| Step 2 | `run_command` | npm create vite | FAILURE | Operation cancelled |',
    ].join('\n')

    const result = HeuristicContextCompactor.compile(
      {
        systemPrompt: makeRepeated('IMMUTABLE SYSTEM DIRECTIVES.\n', 400),
        activePlanBlock: makeRepeated('PLAN MILESTONE.\n', 200),
        pinnedFilesBlock: makeRepeated('PINNED.\n', 200),
        activeFileBlock: '',
        skillsBlock: makeRepeated('SKILL.\n', 100),
        historyBlock: history,
        attachedContext: makeRepeated('RAG.\n', 200),
        projectMapBlock: makeRepeated('MAP.\n', 200),
      },
      16_000
    )

    expect(result.wasCompacted).toBe(true)
    expect(result.prompt).toContain('COMPLETE EXECUTION TRAJECTORY')
    expect(result.prompt).toContain('Operation cancelled')
  })

  it('should measure the prompt once, not twice (regression: stableSection was passed as systemPrompt alongside its own parts)', () => {
    const parts = {
      systemPrompt: FAKE_SYSTEM_PROMPT,
      activePlanBlock: FAKE_PLAN,
      pinnedFilesBlock: makeRepeated('PINNED.\n', 50),
      activeFileBlock: '',
      skillsBlock: makeRepeated('SKILL.\n', 50),
      historyBlock: makeRepeated('HISTORY.\n', 50),
      attachedContext: makeRepeated('RAG.\n', 50),
      projectMapBlock: makeRepeated('MAP.\n', 50),
    }
    const disjointSize = Object.values(parts).filter(Boolean).join('\n\n').length
    const result = HeuristicContextCompactor.compile(parts, 200_000)
    expect(result.originalChars).toBe(disjointSize)
  })
})
