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
    expect(detectRedundantWrite(true, body, body)).toMatchObject({ isRedundant: true, kind: 'identical' })
  })

  it('treats a CRLF/LF difference as no change — the dominant phantom rewrite on Windows', () => {
    const onDisk = 'const a = 1\r\nconst b = 2\r\n'
    const proposed = 'const a = 1\nconst b = 2\n'
    expect(detectRedundantWrite(true, onDisk, proposed)).toMatchObject({ isRedundant: true, kind: 'line_endings_only' })
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

/**
 * Live run of 2026-08-25: `src/services/TaskService.ts` was written with an empty body, created
 * at zero bytes, and every identical retry was answered "the deliverable exists and is correct"
 * — while the milestone probe reported the same file as missing-or-empty and `update_plan`
 * refused the milestone. Two system messages about one file, saying opposite things, for
 * eighteen blocked steps.
 */
describe('an empty file is never "already up to date"', () => {
  it('flags the redundant write as empty', () => {
    expect(detectRedundantWrite(true, '', '')).toMatchObject({ isRedundant: true, isEmpty: true })
  })

  it('does not flag a file that actually has content', () => {
    expect(detectRedundantWrite(true, 'export const a = 1\n', 'export const a = 1\n')).toMatchObject({ isEmpty: false })
  })

  it('treats whitespace-only as empty, because it is not a deliverable either', () => {
    expect(detectRedundantWrite(true, '\n  \n', '\n  \n')).toMatchObject({ isEmpty: true })
  })

  it('never tells the model an empty deliverable is correct', () => {
    const notice = buildRedundantWriteNotice('src/services/TaskService.ts', 'identical', true)

    expect(notice).not.toContain('exists and is correct')
    expect(notice).toContain('cannot satisfy the milestone')
    expect(notice).toContain('COMPLETE body of the file')
  })

  it('keeps the ordinary reassurance for a file that does have content', () => {
    const notice = buildRedundantWriteNotice('src/App.tsx', 'identical', false)

    expect(notice).toContain('the deliverable exists and is correct')
  })
})
