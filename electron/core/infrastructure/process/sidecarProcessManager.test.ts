import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => process.cwd()),
    getPath: vi.fn(() => process.cwd()),
    isPackaged: false,
  },
}))

import { SidecarProcessManager } from './sidecarProcessManager'

describe('SidecarProcessManager process state', () => {
  it('marks an online sidecar offline when its owned process exits', () => {
    const manager = new SidecarProcessManager()
    ;(manager as any).state = { status: 'online' }

    ;(manager as any).markProcessExited(1)

    expect(manager.getSidecarState()).toEqual({ status: 'offline', error: 'Process exited with code 1' })
  })
})
