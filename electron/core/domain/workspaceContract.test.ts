import { describe, expect, it } from 'vitest'
import {
  workspaceExecutePowerShellPayloadSchema,
  workspaceListFilesPayloadSchema,
  workspaceReadFilePayloadSchema,
  workspaceSearchWebPayloadSchema,
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
    expect(() => workspaceListFilesPayloadSchema.parse({ targetPath: 'src', extra: true })).toThrow()
  })

  it('bounds essential web and shell inputs', () => {
    expect(workspaceSearchWebPayloadSchema.parse({ query: 'react', maxResults: 8 })).toEqual({ query: 'react', maxResults: 8 })
    expect(() => workspaceSearchWebPayloadSchema.parse({ query: ' ' })).toThrow()
    expect(() => workspaceExecutePowerShellPayloadSchema.parse({ command: 'Get-ChildItem', timeoutMs: 900_001 })).toThrow()
  })
})
