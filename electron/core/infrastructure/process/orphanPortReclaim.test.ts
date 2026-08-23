import { describe, it, expect } from 'vitest'
import {
  decidePortReclaim,
  isReclaimableSidecarImage,
  parseImageNameFromTasklist,
  parseListeningPidFromNetstat,
} from './orphanPortReclaim'

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

describe('parseImageNameFromTasklist', () => {
  it('reads the image name out of the CSV row', () => {
    expect(parseImageNameFromTasklist('"python.exe","13664","Console","1","45.000 K"')).toBe('python.exe')
  })

  it('treats the "no tasks are running" notice as no process, in any locale', () => {
    // Verified against the real tool on this machine: an Italian Windows answers
    // "Informazioni: nessuna attività...", so matching the English "INFO:" would miss it.
    // Neither form is quoted, which is what the parser actually keys on.
    expect(parseImageNameFromTasklist('INFO: No tasks are running which match the specified criteria.')).toBeNull()
    expect(parseImageNameFromTasklist('Informazioni: nessuna attività in esecuzione corrispondente ai\ncriteri specificati.')).toBeNull()
  })

  it('returns null for empty output', () => {
    expect(parseImageNameFromTasklist('')).toBeNull()
  })
})

describe('isReclaimableSidecarImage', () => {
  it('accepts the packaged binary and the interpreters the dev sidecar runs under', () => {
    expect(isReclaimableSidecarImage('sidecar.exe')).toBe(true)
    expect(isReclaimableSidecarImage('Python.exe')).toBe(true)
    expect(isReclaimableSidecarImage('pythonw.exe')).toBe(true)
  })

  it('refuses anything else, however plausible it looks', () => {
    expect(isReclaimableSidecarImage('node.exe')).toBe(false)
    expect(isReclaimableSidecarImage('uvicorn.exe')).toBe(false)
    expect(isReclaimableSidecarImage(null)).toBe(false)
  })
})

describe('decidePortReclaim', () => {
  it('kills an orphan sidecar holding the port', () => {
    expect(decidePortReclaim({ pid: 13664, imageName: 'sidecar.exe', ownPid: 4242 })).toEqual({ action: 'kill', pid: 13664 })
  })

  it('never kills the process doing the reclaiming', () => {
    const decision = decidePortReclaim({ pid: 4242, imageName: 'python.exe', ownPid: 4242 })
    expect(decision.action).toBe('skip')
  })

  it('leaves an unrelated process alone rather than freeing the port at any cost', () => {
    const decision = decidePortReclaim({ pid: 900, imageName: 'node.exe', ownPid: 4242 })
    expect(decision).toEqual({ action: 'skip', reason: 'process 900 runs "node.exe", which is not a known sidecar image' })
  })

  it('skips when the holder could not be resolved at all', () => {
    const decision = decidePortReclaim({ pid: null, imageName: null, ownPid: 4242 })
    expect(decision.action).toBe('skip')
  })
})
