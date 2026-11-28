import { describe, it, expect } from 'vitest'
import { isProcessOrDescendant, matchesSidecarOwnership, parseListeningPidFromNetstat } from './orphanPortReclaim'

const NETSTAT_OUTPUT = [
  '',
  'Active Connections',
  '',
  '  Proto  Local Address          Foreign Address        State           PID',
  '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1084',
  '  TCP    127.0.0.1:8000         0.0.0.0:0              LISTENING       13664',
  '  TCP    127.0.0.1:8000         127.0.0.1:54992        ESTABLISHED     22140',
  '  TCP    [::]:8000              [::]:0                 LISTENING       13664',
  '',
].join('\r\n')

describe('parseListeningPidFromNetstat', () => {
  it('finds the PID listening on the requested port', () => {
    expect(parseListeningPidFromNetstat(NETSTAT_OUTPUT, 8000)).toBe(13664)
  })

  it('ignores established connections to the same port, which belong to clients', () => {
    const clientOnly = '  TCP    127.0.0.1:8000         127.0.0.1:54992        ESTABLISHED     22140'
    expect(parseListeningPidFromNetstat(clientOnly, 8000)).toBeNull()
  })

  it('does not confuse a port that merely ends with the same digits', () => {
    const other = '  TCP    127.0.0.1:18000        0.0.0.0:0              LISTENING       999'
    expect(parseListeningPidFromNetstat(other, 8000)).toBeNull()
  })

  it('returns null for empty or header-only output', () => {
    expect(parseListeningPidFromNetstat('', 8000)).toBeNull()
    expect(parseListeningPidFromNetstat('Active Connections\n\n  Proto  Local Address', 8000)).toBeNull()
  })
})

describe('matchesSidecarOwnership', () => {
  const marker = { pid: 13664, executablePath: 'C:\\venv\\python.exe', startedAt: '2026-09-22T10:00:00.000Z' }
  it('accepts the exact owned process only', () => {
    expect(matchesSidecarOwnership(marker, { ...marker, executablePath: 'c:\\VENV\\PYTHON.EXE' })).toBe(true)
  })
  it('rejects missing marker, reused PID, different executable, and changed start time', () => {
    expect(matchesSidecarOwnership(null, marker)).toBe(false)
    expect(matchesSidecarOwnership(marker, { ...marker, pid: 1 })).toBe(false)
    expect(matchesSidecarOwnership(marker, { ...marker, executablePath: 'C:\\other\\python.exe' })).toBe(false)
    expect(matchesSidecarOwnership(marker, { ...marker, startedAt: '2026-09-22T11:00:00.000Z' })).toBe(false)
  })
})

describe('isProcessOrDescendant', () => {
  // venv launcher 100 -> base interpreter 200 (listener); 300 is an unrelated process under explorer 4.
  const parents = new Map<number, number>([
    [200, 100],
    [100, 50],
    [300, 4],
  ])
  const readParentPid = async (pid: number) => parents.get(pid) ?? null

  it('accepts the spawned process itself', async () => {
    await expect(isProcessOrDescendant(100, 100, readParentPid)).resolves.toBe(true)
  })

  it('accepts the child a venv launcher starts to run the interpreter', async () => {
    await expect(isProcessOrDescendant(200, 100, readParentPid)).resolves.toBe(true)
  })

  it('rejects an unrelated listener', async () => {
    await expect(isProcessOrDescendant(300, 100, readParentPid)).resolves.toBe(false)
  })

  it('stops walking after the depth limit', async () => {
    await expect(isProcessOrDescendant(200, 50, readParentPid, 1)).resolves.toBe(false)
    await expect(isProcessOrDescendant(200, 50, readParentPid, 2)).resolves.toBe(true)
  })
})
