import { describe, expect, it } from 'vitest'
import { parseShellFileRead } from './shellFileRead'

describe('parseShellFileRead', () => {
  it('recognises the single-file reads gpt-oss:20b issued through run_command', () => {
    expect(parseShellFileRead("sed -n '1,200p' package.json")).toBe('package.json')
    expect(parseShellFileRead('cat src/App.tsx')).toBe('src/App.tsx')
    expect(parseShellFileRead('shasum -a 256 src/main.tsx')).toBe('src/main.tsx')
    expect(parseShellFileRead('type index.html')).toBe('index.html')
    expect(parseShellFileRead('Get-Content -Path "src/index.css" -Raw')).toBe('src/index.css')
    expect(parseShellFileRead('head -n 40 src/App.tsx')).toBe('src/App.tsx')
  })

  it('leaves anything more than one plain read to run_command', () => {
    expect(parseShellFileRead('cat a.txt b.txt')).toBeNull()
    expect(parseShellFileRead('cat package.json | grep react')).toBeNull()
    expect(parseShellFileRead('cat src/*.ts')).toBeNull()
    expect(parseShellFileRead("sed -i 's/a/b/' file.txt")).toBeNull()
    expect(parseShellFileRead('cat > out.txt')).toBeNull()
    expect(parseShellFileRead('npm run build')).toBeNull()
    expect(parseShellFileRead('cat')).toBeNull()
  })
})
