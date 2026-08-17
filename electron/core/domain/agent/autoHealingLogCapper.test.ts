import { describe, it, expect } from 'vitest'
import { AutoHealingLogCapper } from './autoHealingLogCapper'

function makeAutoHealingBlock(step: number): string {
  return [
    `#### [Step ${step} - Tool: run_command]`,
    '```',
    `Command: "npm test" (Exit Code: 1)`,
    '[TERMINAL AUTO-HEALING DIAGNOSTICS LOG]',
    `FAIL: something broke at step ${step}`,
    '```',
  ].join('\n')
}

function makeNormalBlock(step: number): string {
  return [
    `#### [Step ${step} - Tool: read_file]`,
    '```',
    `Successfully read src/foo.ts`,
    '```',
  ].join('\n')
}

describe('AutoHealingLogCapper', () => {
  it('returns text unchanged when at or under the max block count', () => {
    const history = [makeNormalBlock(1), makeAutoHealingBlock(2), makeAutoHealingBlock(3)].join('\n\n')
    const result = AutoHealingLogCapper.capBlocks(history, 2)

    expect(result.capped).toBe(false)
    expect(result.totalBlocks).toBe(2)
    expect(result.removedBlocks).toBe(0)
    expect(result.text).toBe(history)
  })

  it('caps auto-healing blocks to the most recent N and preserves other blocks', () => {
    const history = [
      makeAutoHealingBlock(1),
      makeNormalBlock(2),
      makeAutoHealingBlock(3),
      makeAutoHealingBlock(4),
      makeAutoHealingBlock(5),
    ].join('\n\n')

    const result = AutoHealingLogCapper.capBlocks(history, 2)

    expect(result.capped).toBe(true)
    expect(result.totalBlocks).toBe(4)
    expect(result.removedBlocks).toBe(2)
    // Oldest auto-healing blocks (Step 1, Step 3) collapsed
    expect(result.text).toContain('#### [Step 1 - Tool: run_command]\n[auto-healing diagnostics compacted')
    expect(result.text).toContain('#### [Step 3 - Tool: run_command]\n[auto-healing diagnostics compacted')
    // Most recent two auto-healing blocks (Step 4, Step 5) preserved in full
    expect(result.text).toContain('FAIL: something broke at step 4')
    expect(result.text).toContain('FAIL: something broke at step 5')
    // Non-auto-healing block untouched
    expect(result.text).toContain('Successfully read src/foo.ts')
  })

  it('handles empty input safely', () => {
    const result = AutoHealingLogCapper.capBlocks('', 2)
    expect(result.capped).toBe(false)
    expect(result.totalBlocks).toBe(0)
    expect(result.text).toBe('')
  })

  it('respects a custom maxBlocks value', () => {
    const history = [makeAutoHealingBlock(1), makeAutoHealingBlock(2), makeAutoHealingBlock(3)].join('\n\n')
    const result = AutoHealingLogCapper.capBlocks(history, 1)

    expect(result.capped).toBe(true)
    expect(result.totalBlocks).toBe(3)
    expect(result.removedBlocks).toBe(2)
    expect(result.text).toContain('FAIL: something broke at step 3')
    expect(result.text).not.toContain('FAIL: something broke at step 1')
    expect(result.text).not.toContain('FAIL: something broke at step 2')
  })
})
