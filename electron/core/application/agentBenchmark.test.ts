import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { parseAgentToolCall } from '../domain/agent/toolParser'
import { checkCommandSecurity } from '../domain/agent/commandSecurity'
import { validatePathSafety, isIgnoredPath } from '../domain/agent/contextFilter'

describe('Agent Engine Synthetic End-to-End Benchmark Suite', () => {
  const repoRoot = process.cwd()

  it('Scenario A (Full Cycle): Read File -> Bug Detection -> Chunk Replace -> Verification', () => {
    // 1. Step 1 LLM response proposes reading file
    const llmStep1 = `\`\`\`json
{
  "tool": "read_file",
  "parameters": {
    "filePath": "src/utils/math.ts"
  },
  "explanation": "Reading math utility to locate calculation bug"
}
\`\`\``
    const step1Parsed = parseAgentToolCall(llmStep1)
    expect(step1Parsed).not.toBeNull()
    expect(step1Parsed?.tool).toBe('read_file')
    expect(step1Parsed?.parameters.filePath).toBe('src/utils/math.ts')

    // 2. Validate path safety against repository root
    const pathCheck = validatePathSafety(step1Parsed!.parameters.filePath, repoRoot)
    expect(pathCheck.safePath).not.toBeNull()

    // 3. Step 2 LLM response proposes replace_file_content fix
    const llmStep2 = `\`\`\`json
{
  "tool": "replace_file_content",
  "parameters": {
    "filePath": "src/utils/math.ts",
    "targetContent": "return a - b // BUG",
    "replacementContent": "return a + b"
  },
  "explanation": "Fixing addition bug in math utility"
}
\`\`\``
    const step2Parsed = parseAgentToolCall(llmStep2)
    expect(step2Parsed).not.toBeNull()
    expect(step2Parsed?.tool).toBe('replace_file_content')
    expect(step2Parsed?.parameters.targetContent).toBe('return a - b // BUG')
    expect(step2Parsed?.parameters.replacementContent).toBe('return a + b')

    // 4. Step 3 LLM response completes task
    const llmStep3 = `\`\`\`json
{
  "tool": "finish",
  "parameters": {
    "summary": "Fixed calculation bug in math.ts successfully."
  }
}
\`\`\``
    const step3Parsed = parseAgentToolCall(llmStep3)
    expect(step3Parsed).not.toBeNull()
    expect(step3Parsed?.tool).toBe('finish')
  })

  it('Scenario B (Out of Scope / Explanation Only): Minimal response without code modifications', () => {
    const llmResponse = `\`\`\`json
{
  "tool": "finish",
  "parameters": {
    "summary": "React is a JavaScript library for building user interfaces."
  },
  "explanation": "Explaining concept without workspace file modifications"
}
\`\`\``
    const parsed = parseAgentToolCall(llmResponse)
    expect(parsed).not.toBeNull()
    expect(parsed?.tool).toBe('finish')
    expect(parsed?.explanation).toContain('without workspace file modifications')
  })

  it('Scenario C (Security Interception Benchmark): Rejecting malicious command & traversal attempts', () => {
    // 1. Destructive Git Reset Attempt
    const maliciousCmd = 'git reset --hard HEAD~1'
    const secCheck = checkCommandSecurity(maliciousCmd)
    expect(secCheck.isAllowed).toBe(false)
    expect(secCheck.blockedReason).toContain('Destructive command pattern detected')

    // 2. Traversal Read Attempt
    const traversalPath = path.resolve(repoRoot, '../../external-secret-folder/secret.txt')
    const pathCheck = validatePathSafety(traversalPath, repoRoot)
    expect(pathCheck.safePath).toBeNull()
    expect(pathCheck.error).toContain('Directory Traversal Blocked')

    // 3. Secret File Read Attempt
    const secretPath = path.resolve(repoRoot, '.env.production')
    const secretCheck = validatePathSafety(secretPath, repoRoot)
    expect(secretCheck.safePath).toBeNull()
    expect(secretCheck.error).toContain('contains sensitive credentials/secrets')
  })
})
