import { describe, it, expect } from 'vitest'
import { detectRedundantWrite, buildRedundantWriteNotice } from './redundantWriteDetector'

/**
 * The churn loop this closes: a write that changed nothing was reported as "Successfully wrote
 * file X" and counted as a file mutation, which cleared the verified-build flag and forced the
 * model to run its already-green build again. See redundantWriteDetector.ts.
 */
describe('detectRedundantWrite', () => {
  it('reports a byte-identical rewrite as redundant', () => {
    const body = "export const a = 1\nexport const b = 2\n"
    expect(detectRedundantWrite(true, body, body)).toEqual({ isRedundant: true, kind: 'identical' })
  })

  it('treats a CRLF/LF difference as no change — the dominant phantom rewrite on Windows', () => {
    const onDisk = 'const a = 1\r\nconst b = 2\r\n'
    const proposed = 'const a = 1\nconst b = 2\n'
    expect(detectRedundantWrite(true, onDisk, proposed)).toEqual({ isRedundant: true, kind: 'line_endings_only' })
  })

  it('treats a missing trailing newline as no change', () => {
    expect(detectRedundantWrite(true, 'const a = 1\n', 'const a = 1').isRedundant).toBe(true)
  })

  it('reports a real content change as a real write', () => {
    expect(detectRedundantWrite(true, 'const a = 1\n', 'const a = 2\n').isRedundant).toBe(false)
  })

  it('does not collapse an indentation change: reformatting is a real edit', () => {
    expect(detectRedundantWrite(true, 'if (x) {\n  go()\n}\n', 'if (x) {\n    go()\n}\n').isRedundant).toBe(false)
  })

  it('does not collapse an added blank line inside the file', () => {
    expect(detectRedundantWrite(true, 'a\nb\n', 'a\n\nb\n').isRedundant).toBe(false)
  })

  // Creating a file is always a mutation, and an absent file reads back as '' exactly like an
  // empty one — which is why existence is passed in rather than inferred from the content.
  it('never calls a creation redundant, not even of an empty file', () => {
    expect(detectRedundantWrite(false, '', '').isRedundant).toBe(false)
    expect(detectRedundantWrite(false, '', 'anything').isRedundant).toBe(false)
  })

  it('reports rewriting an already-empty file as redundant', () => {
    expect(detectRedundantWrite(true, '', '').isRedundant).toBe(true)
  })
})

describe('buildRedundantWriteNotice', () => {
  it('states the build is still valid, so the model does not re-verify what it never broke', () => {
    const notice = buildRedundantWriteNotice('src/App.tsx', 'identical')
    expect(notice).toContain('src/App.tsx')
    expect(notice).toContain('NO-OP WRITE')
    expect(notice.toLowerCase()).toContain('still valid')
  })

  it('names the line-ending case explicitly rather than claiming the bytes matched', () => {
    const notice = buildRedundantWriteNotice('src/App.tsx', 'line_endings_only')
    expect(notice).toContain('line endings')
    expect(notice).not.toContain('byte for byte')
  })

  // A pure prohibition is what produced the loop in the first place: every notice has to end
  // on something the model can actually do next.
  it('offers a next action, not only a refusal', () => {
    const notice = buildRedundantWriteNotice('src/App.tsx', 'identical')
    expect(notice).toContain('update_plan')
    expect(notice).toContain('finish')
  })
})
