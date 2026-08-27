import { describe, expect, it } from 'vitest'
import { executeListFilesRecursiveTool } from './listFilesRecursiveTool'

describe('executeListFilesRecursiveTool', () => {
  it('limits depth and delegates ignored-directory policy', () => {
    let receivedDepth = 0
    let receivedIgnored: Set<string> | undefined
    const result = executeListFilesRecursiveTool(
      { dirPath: 'src', maxDepth: 99 },
      'C:/workspace',
      {
        exists: () => true,
        listRecursive: (_root, depth, ignored) => {
          receivedDepth = depth
          receivedIgnored = ignored
          return ['[FILE] main.ts']
        },
      },
    )

    expect(result.outputForHistory).toContain('depth <= 6')
    expect(receivedDepth).toBe(6)
    expect(receivedIgnored?.has('node_modules')).toBe(true)
  })

  it('rejects paths outside the workspace', () => {
    const result = executeListFilesRecursiveTool(
      { dirPath: '../secrets' },
      'C:/workspace',
      { exists: () => true, listRecursive: () => [] },
    )

    expect(result.outputForHistory).toContain('Security Violation')
  })
})
