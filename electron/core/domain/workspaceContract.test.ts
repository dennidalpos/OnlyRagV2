import { describe, expect, it } from 'vitest'
import {
  workspaceExecutePowerShellPayloadSchema,
  workspaceListFilesPayloadSchema,
  workspaceReadFilePayloadSchema,
  workspaceWriteFilePayloadSchema,
} from './workspaceContract'

describe('workspace IPC contracts', () => {
  it('preserves valid optional list and empty-file write payloads', () => {
    expect(workspaceListFilesPayloadSchema.parse({})).toEqual({})
    expect(workspaceWriteFilePayloadSchema.parse({ filePath: 'src/empty.ts', content: '' })).toEqual({
      filePath: 'src/empty.ts',
      content: '',
    })
  })

  it('rejects blank paths, non-positive line numbers, and unknown fields', () => {
    expect(() => workspaceReadFilePayloadSchema.parse({ filePath: ' ', startLine: 1 })).toThrow()
    expect(() => workspaceReadFilePayloadSchema.parse({ filePath: 'a.ts', startLine: 0 })).toThrow()
    expect(() => workspaceListFilesPayloadSchema.parse({ dirPath: 'src', extra: true })).toThrow()
    expect(() => workspaceWriteFilePayloadSchema.parse({ filePath: 'a.ts', content: 'x', expectedContentHash: 'stale' })).toThrow()
  })

  it('bounds shell inputs', () => {
    expect(() => workspaceExecutePowerShellPayloadSchema.parse({ command: 'Get-ChildItem', timeoutMs: 900_001 })).toThrow()
  })
})
