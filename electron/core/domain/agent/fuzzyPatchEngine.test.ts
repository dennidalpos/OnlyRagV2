import { describe, it, expect } from 'vitest'
import { applyFuzzyReplace, validateAST } from './fuzzyPatchEngine'

describe('fuzzyPatchEngine', () => {
  it('should perform exact string chunk replacement', () => {
    const fileContent = 'function hello() {\n  console.log("world")\n}'
    const targetContent = 'console.log("world")'
    const replacementContent = 'console.log("hello world")'

    const result = applyFuzzyReplace(fileContent, targetContent, replacementContent)
    expect(result.success).toBe(true)
    expect(result.confidenceScore).toBe(1.0)
    expect(result.updatedContent).toContain('console.log("hello world")')
  })

  it('should perform fuzzy chunk replacement on whitespace/indentation drift', () => {
    const fileContent = 'const sum = (a, b) => {\n    return a + b;\n}'
    const targetContent = 'return a + b;'
    const replacementContent = 'return a + b + 0;'

    const result = applyFuzzyReplace(fileContent, targetContent, replacementContent)
    expect(result.success).toBe(true)
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0.8)
    expect(result.updatedContent).toContain('return a + b + 0;')
  })

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
