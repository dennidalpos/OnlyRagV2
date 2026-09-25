import { describe, it, expect } from 'vitest'
import { validateAST } from './fuzzyPatchEngine'

describe('fuzzyPatchEngine', () => {
  it('should validate valid TypeScript AST syntax', () => {
    const validTs = 'export function add(a: number, b: number): number { return a + b }'
    const res = validateAST('math.ts', validTs)
    expect(res.isValid).toBe(true)
  })

  it('should reject invalid TypeScript AST syntax with error details', () => {
    const invalidTs = 'export function add(a: number, b: number): number { return a +'
    const res = validateAST('math.ts', invalidTs)
    expect(res.isValid).toBe(false)
    expect(res.syntaxError).toBeDefined()
  })

  it('accepts JSX in .js and .jsx files as the bundlers do, but not in .ts', () => {
    const jsx = `export default function App() {
  return (
    <div className="p-4">
      <span>hi</span>
    </div>
  )
}
`
    expect(validateAST('src/App.js', jsx).isValid).toBe(true)
    expect(validateAST('src/App.jsx', jsx).isValid).toBe(true)
    expect(validateAST('src/App.tsx', jsx).isValid).toBe(true)
    expect(validateAST('src/App.ts', jsx)).toMatchObject({ isValid: false, syntaxError: "AST Syntax Error: '>' expected." })
  })

  it('should validate valid JSON syntax', () => {
    const validJson = '{"name": "onlyrag", "version": "2.0.0"}'
    const res = validateAST('package.json', validJson)
    expect(res.isValid).toBe(true)
  })

  it('should reject invalid JSON syntax', () => {
    const invalidJson = '{"name": "onlyrag", "version":}'
    const res = validateAST('package.json', invalidJson)
    expect(res.isValid).toBe(false)
    expect(res.syntaxError).toContain('JSON Syntax Error')
  })
})
