import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { executeReadFileTool, type ReadFileRepository } from './readFileTool'
import type { ListDirectoryRepository } from './listDirectoryTool'

const workspace = path.resolve('/workspace')
const notAFile: ReadFileRepository = { readFile: async () => ({ success: false, error: 'File not found or invalid target' }) }

function directories(tree: Record<string, { name: string; isDir: boolean }[]>): ListDirectoryRepository {
  return {
    listDirEntries: (absolutePath) => {
      if (tree[absolutePath]) return tree[absolutePath]
      if (absolutePath.endsWith('.json')) throw new Error('ENOTDIR')
      return null
    },
  }
}

describe('executeReadFileTool', () => {
  it('returns the content with its version', async () => {
    const repository: ReadFileRepository = { readFile: async () => ({ success: true, content: 'hello', contentHash: 'sha256:abc' }) }

    const result = await executeReadFileTool({ filePath: 'a.txt' }, workspace, repository)

    expect(result.outcome).toBe('success')
    expect(result.outputForHistory).toContain('[FILE VERSION: sha256:abc]')
    expect(result.outputForHistory).toContain('hello')
  })

  it('lists a directory instead of failing the read', async () => {
    const tree = directories({ [path.join(workspace, 'src')]: [{ name: 'App.jsx', isDir: false }] })

    const result = await executeReadFileTool({ filePath: 'src' }, workspace, notAFile, tree)

    expect(result.outcome).toBe('success')
    expect(result.outputForHistory).toContain('[READ_FILE ON DIRECTORY: src]')
    expect(result.outputForHistory).toContain('[FILE] App.jsx')
  })

  it('reports a missing file as a result with the parent directory listing', async () => {
    const tree = directories({ [path.join(workspace, 'src')]: [{ name: 'App.jsx', isDir: false }] })

    const result = await executeReadFileTool({ filePath: 'src/main.jsx' }, workspace, notAFile, tree)

    expect(result.outcome).toBe('success')
    expect(result.outputForHistory).toContain('[FILE NOT FOUND: src/main.jsx]')
    expect(result.outputForHistory).toContain('Parent directory [src] (1 items)')
    expect(result.outputForHistory).toContain('[FILE] App.jsx')
  })

  it('says when the parent directory is missing too', async () => {
    const result = await executeReadFileTool({ filePath: 'src/main.jsx' }, workspace, notAFile, directories({}))

    expect(result.outcome).toBe('success')
    expect(result.outputForHistory).toContain('Parent directory [src] does not exist either.')
  })

  it('keeps the failure when the file exists but cannot be read', async () => {
    const tooLarge: ReadFileRepository = { readFile: async () => ({ success: false, error: 'File size exceeds 5MB limit' }) }

    const result = await executeReadFileTool({ filePath: 'data.json' }, workspace, tooLarge, directories({}))

    expect(result.outcome).toBe('failure')
    expect(result.outputForHistory).toContain('File size exceeds 5MB limit')
  })

  it('rejects paths outside the workspace', async () => {
    const result = await executeReadFileTool({ filePath: '../secrets.txt' }, workspace, notAFile, directories({}))

    expect(result.outcome).toBe('rejected')
  })
})
