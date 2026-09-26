import { describe, it, expect } from 'vitest'
import { parseNativeToolCall, type ToolCallRejection } from './toolParser'

describe('parseNativeToolCall', () => {
  it('normalizes tool name and parameter aliases', () => {
    const result = parseNativeToolCall('edit_file', { file: 'src/components/Test.tsx', old_str: 'const a = 1', new_str: 'const a = 2' })

    expect(result?.tool).toBe('replace_file_content')
    expect(result?.parameters.filePath).toBe('src/components/Test.tsx')
    expect(result?.parameters.targetContent).toBe('const a = 1')
    expect(result?.parameters.replacementContent).toBe('const a = 2')
  })

  it('maps filesystem aliases (mkdir, cp, mv, tree) to their canonical tools and parameters', () => {
    const mkdir = parseNativeToolCall('mkdir', { path: 'src/components/ui' })
    expect(mkdir?.tool).toBe('create_directory')
    expect(mkdir?.parameters.dirPath).toBe('src/components/ui')

    const copy = parseNativeToolCall('cp', { source: 'src/App.tsx', destination: 'src/App.backup.tsx' })
    expect(copy?.tool).toBe('copy_file')
    expect(copy?.parameters).toMatchObject({ sourcePath: 'src/App.tsx', targetPath: 'src/App.backup.tsx' })

    const move = parseNativeToolCall('mv', { src: 'src/App.tsx', dest: 'src/components/App.tsx' })
    expect(move?.tool).toBe('move_file')
    expect(move?.parameters).toMatchObject({ sourcePath: 'src/App.tsx', targetPath: 'src/components/App.tsx' })

    const tree = parseNativeToolCall('tree', { path: 'src', maxDepth: 4 })
    expect(tree?.tool).toBe('list_files_recursive')
    expect(tree?.parameters.dirPath).toBe('src')
  })

  it('maps multi_replace chunks to replacements', () => {
    const result = parseNativeToolCall('multi_replace', {
      filePath: 'src/App.tsx',
      chunks: [
        { targetContent: 'const a = 1', replacementContent: 'const a = 10' },
        { targetContent: 'const b = 2', replacementContent: 'const b = 20' },
      ],
    })

    expect(result?.tool).toBe('multi_replace_file_content')
    expect(result?.parameters.replacements?.length).toBe(2)
    expect(result?.parameters.replacements?.[0].targetContent).toBe('const a = 1')
  })

  it('maps delete, slice-read and ask aliases', () => {
    expect(parseNativeToolCall('remove_file', { file: 'temp/test.tmp' })).toMatchObject({ tool: 'delete_file', parameters: { filePath: 'temp/test.tmp' } })

    const slice = parseNativeToolCall('view_file_slice', { filePath: 'src/main.ts', start_line: 10, end_line: 35 })
    expect(slice).toMatchObject({ tool: 'read_file', parameters: { filePath: 'src/main.ts', startLine: 10, endLine: 35 } })

    expect(parseNativeToolCall('ask_question', { query: "Vuoi procedere con l'installazione?" })).toMatchObject({
      tool: 'ask',
      parameters: { question: "Vuoi procedere con l'installazione?" },
    })
  })

  it('maps the extended aliases (run_cmd, write_code, replace_file, find_text, read_url_content)', () => {
    expect(parseNativeToolCall('run_cmd', { command: 'git status' })?.tool).toBe('run_command')
    expect(parseNativeToolCall('write_code', { filePath: 'index.ts', content: 'console.log(1)' })?.tool).toBe('write_file')
    expect(parseNativeToolCall('replace_file', { filePath: 'index.ts', targetContent: '1', replacementContent: '2' })?.tool).toBe('replace_file_content')
    expect(parseNativeToolCall('find_text', { query: 'useTranslation' })?.tool).toBe('grep_search')
    expect(parseNativeToolCall('read_url_content', { url: 'https://example.com' })?.tool).toBe('fetch_web_content')
  })

  it('joins a run_command command given as an array of strings', () => {
    expect(parseNativeToolCall('run_command', { command: ['npm install', 'npm run build'] })?.parameters.command).toBe('npm install; npm run build')
  })

  it('reports which tool was refused and why', () => {
    const rejections: ToolCallRejection[] = []
    expect(parseNativeToolCall('write_file', { content: 'hello' }, (rejection) => rejections.push(rejection))).toBeNull()

    expect(rejections).toHaveLength(1)
    expect(rejections[0].toolName).toBe('write_file')
    expect(rejections[0].errors.join(' ')).toContain('filePath')
  })

  it('rejects an unknown tool name', () => {
    const rejections: ToolCallRejection[] = []
    expect(parseNativeToolCall('teleport_file', {}, (rejection) => rejections.push(rejection))).toBeNull()
    expect(rejections).toHaveLength(1)
    expect(rejections[0].toolName).toBe('teleport_file')
  })

  it('stays silent on a valid call and works without a sink', () => {
    const rejections: ToolCallRejection[] = []
    expect(parseNativeToolCall('read_file', { filePath: 'src/App.tsx' }, (rejection) => rejections.push(rejection))?.tool).toBe('read_file')
    expect(rejections).toHaveLength(0)
    expect(parseNativeToolCall('write_file', {})).toBeNull()
  })
})
