import { expect, it } from 'vitest'
import { SessionDeletionRunGate } from './sessionDeletionRunGate'

it('refuses deletion until every active run settles and excludes new runs until restore', () => {
  const gate = new SessionDeletionRunGate()
  const endFirst = gate.beginRun('session')
  const endSecond = gate.beginRun('session')
  expect(endFirst).not.toBeNull()
  expect(endSecond).not.toBeNull()
  expect(gate.reserveDeletion(['session'])).toBe(false)
  endFirst?.()
  endFirst?.()
  expect(gate.reserveDeletion(['session'])).toBe(false)
  endSecond?.()
  expect(gate.reserveDeletion(['session'])).toBe(true)
  expect(gate.beginRun('session')).toBeNull()
  expect(gate.beginRun('unrelated')).not.toBeNull()
  gate.releaseDeletion(['session'])
  expect(gate.beginRun('session')).not.toBeNull()
})

it('refuses workspace clear during a run and blocks new runs while clear reads candidates', () => {
  const gate = new SessionDeletionRunGate()
  const endRun = gate.beginRun('first', 'C:/work')
  expect(gate.reserveWorkspaceClear('c:/WORK')).toBe(false)
  endRun?.()
  expect(gate.reserveWorkspaceClear('C:/work')).toBe(true)
  expect(gate.beginRun('second', 'C:/work')).toBeNull()
  expect(gate.beginRun('second', 'C:/other')).not.toBeNull()
  gate.releaseWorkspaceClear('C:/work')
  expect(gate.beginRun('second', 'C:/work')).not.toBeNull()
})
