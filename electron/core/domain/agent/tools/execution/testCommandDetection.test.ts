import { describe, expect, it } from 'vitest'
import { detectTestCommand } from './testCommandDetection'

const noPytest = () => false

describe('test command detection', () => {
  it('prefers the fast npm script', () => {
    expect(detectTestCommand('workspace', () => ({ test: 'vitest', 'test:fast': 'vitest --run' }), noPytest))
      .toEqual({ command: 'npm run test:fast', source: 'package.json scripts["test:fast"]' })
  })

  it('falls back to the standard npm test script', () => {
    expect(detectTestCommand('workspace', () => ({ test: 'vitest' }), noPytest))
      .toEqual({ command: 'npm test', source: 'package.json scripts.test' })
  })

  it('detects pytest when npm scripts are absent', () => {
    expect(detectTestCommand('workspace', () => null, () => true))
      .toEqual({ command: 'pytest -q', source: 'pytest config file detected' })
  })

  it('returns no command when no supported runner is present', () => {
    expect(detectTestCommand('workspace', () => ({}), noPytest)).toBeNull()
  })
})
