import { describe, expect, it } from 'vitest'
import { errorCode, errorMessage } from './errorMessage'

describe('errorMessage', () => {
  it('reads the message of every value a catch clause can receive', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
    expect(errorMessage('plain')).toBe('plain')
    expect(errorMessage({ error: 'ipc failure' })).toBe('ipc failure')
    expect(errorMessage({ detail: 'sidecar detail' })).toBe('sidecar detail')
    expect(errorMessage({ other: 1 })).toBe('{"other":1}')
    expect(errorMessage(undefined)).toBe('Unknown error')
    expect(errorMessage(42)).toBe('42')
  })

  it('reads a Node.js error code only when it is a string', () => {
    expect(errorCode(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe('ENOENT')
    expect(errorCode({ code: 128 })).toBeUndefined()
    expect(errorCode(null)).toBeUndefined()
  })
})
