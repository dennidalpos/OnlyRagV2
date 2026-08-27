import { describe, expect, it } from 'vitest'
import { executeListDirectoryTool } from './listDirectoryTool'

describe('executeListDirectoryTool', () => {
  it('lists entries through the repository boundary', () => {
    const result = executeListDirectoryTool(
      { dirPath: 'src' },
      'C:/workspace',
      { listDirEntries: () => [{ name: 'main.ts', isDir: false }, { name: 'components', isDir: true }] },
    )

    expect(result.outputForHistory).toContain('Listed directory [src] (2 items)')
    expect(result.outputForHistory).toContain('[FILE] main.ts')
    expect(result.outputForHistory).toContain('[DIR] components')
  })

  it('rejects paths outside the workspace', () => {
    const result = executeListDirectoryTool(
      { dirPath: '../secrets' },
      'C:/workspace',
      { listDirEntries: () => [] },
    )

    expect(result.outputForHistory).toContain('Security Violation')
  })

  it('reports a missing directory without throwing', () => {
    const result = executeListDirectoryTool(
      { dirPath: 'missing' },
      'C:/workspace',
      { listDirEntries: () => null },
    )

    expect(result.outputForHistory).toBe('Directory not found: missing')
  })
})
