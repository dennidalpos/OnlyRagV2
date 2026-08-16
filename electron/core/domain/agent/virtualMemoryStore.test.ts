import { describe, it, expect } from 'vitest'
import { VirtualMemorySymbolStore } from './virtualMemoryStore'

describe('VirtualMemorySymbolStore', () => {
  it('should store and compile virtual memory facts across steps', () => {
    const store = new VirtualMemorySymbolStore()
    store.recordFileFact('src/auth.ts', 2, ['loginUser', 'verifyToken'], 'Auth Service Module', 'export function loginUser() {}')

    expect(store.hasFileFact('src/auth.ts')).toBe(true)
    const block = store.compileVirtualMemoryBlock()
    expect(block).toContain('VIRTUAL MEMORY STORE')
    expect(block).toContain('src/auth.ts')
    expect(block).toContain('loginUser')
  })
})
