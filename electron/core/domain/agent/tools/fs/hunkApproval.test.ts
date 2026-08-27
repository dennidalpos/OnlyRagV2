import { describe, expect, it } from 'vitest'
import { reconcileApprovedHunks } from './hunkApproval'

describe('hunk approval', () => {
  it('keeps the original call when every hunk is approved', () => {
    const tool = { tool: 'write_file' as const, parameters: { filePath: 'src/a.ts', content: 'new\n' } }
    expect(reconcileApprovedHunks(tool, [0], 'old\n')).toBe(tool)
  })

  it('converts a partial write approval into a write containing approved changes', () => {
    const tool = {
      tool: 'write_file' as const,
      parameters: { filePath: 'src/a.ts', content: 'one\nold\nthree\n' },
    }
    expect(reconcileApprovedHunks(tool, [0], 'old\n')).toMatchObject({
      tool: 'write_file', parameters: { content: 'one\nold' },
    })
  })

  it('leaves non-mutating tools unchanged', () => {
    const tool = { tool: 'read_file' as const, parameters: { filePath: 'src/a.ts' } }
    expect(reconcileApprovedHunks(tool, [], 'old\n')).toBe(tool)
  })
})
