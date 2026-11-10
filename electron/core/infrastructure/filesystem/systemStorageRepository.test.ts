import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SystemStorageRepository } from './systemStorageRepository'

describe('model storage volume measurement', () => {
  const repo = new SystemStorageRepository()
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('keeps a configured destination even before it exists and probes only its existing ancestor', () => {
    const destination = 'Z:\\models\\new-store'
    vi.stubEnv('OLLAMA_MODELS', destination)
    vi.spyOn(fs, 'statSync').mockImplementation(((dir: string) => {
      if (dir !== 'Z:\\') throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return { isDirectory: () => true }
    }) as typeof fs.statSync)
    const statfs = vi.spyOn(fs, 'statfsSync').mockReturnValue({ bavail: 2, bsize: 4096, blocks: 10 } as fs.StatsFs)
    expect(repo.getOllamaStoragePath()).toBe(destination)
    expect(repo.getDiskFreeSpace(repo.getOllamaStoragePath())).toEqual({ freeBytes: 8192, totalBytes: 40960 })
    expect(statfs).toHaveBeenCalledExactlyOnceWith('Z:\\')
  })

  it.each(['EACCES', 'ENOTDIR', 'EIO'])('does not fall back to another volume after %s', (code) => {
    const stat = fs.statSync
    vi.spyOn(fs, 'statSync').mockImplementation(((dir: string, ...args: unknown[]) => {
      if (String(dir).startsWith('Z:')) throw Object.assign(new Error(code), { code })
      return Reflect.apply(stat, fs, [dir, ...args])
    }) as typeof stat)
    const statfs = vi.spyOn(fs, 'statfsSync')
    expect(repo.getDiskFreeSpace('Z:\\models')).toBeNull()
    expect(statfs).not.toHaveBeenCalled()
  })

  it('refuses relative paths rather than measuring the checkout volume', () => {
    expect(repo.getDiskFreeSpace('relative-models')).toBeNull()
  })

  it('refuses a dangling link instead of measuring its parent on a different volume', () => {
    const stat = fs.statSync
    vi.spyOn(fs, 'statSync').mockImplementation(((dir: string, ...args: unknown[]) => {
      if (String(dir).startsWith('Z:')) throw Object.assign(new Error('dangling link'), { code: 'ENOENT' })
      return Reflect.apply(stat, fs, [dir, ...args])
    }) as typeof stat)
    vi.spyOn(fs, 'lstatSync').mockReturnValue({ isSymbolicLink: () => true } as fs.Stats)
    const statfs = vi.spyOn(fs, 'statfsSync')
    expect(repo.getDiskFreeSpace('Z:\\dangling')).toBeNull()
    expect(statfs).not.toHaveBeenCalled()
  })

  it('measures the filesystem containing a real selected directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyrag-disk-probe-'))
    if (path.dirname(dir) !== os.tmpdir() || !path.basename(dir).startsWith('onlyrag-disk-probe-')) throw new Error('Invalid cleanup target')
    try {
      vi.stubEnv('OLLAMA_MODELS', dir)
      const native = fs.statfsSync(dir)
      expect(repo.getDiskFreeSpace(repo.getOllamaStoragePath())).toEqual({ freeBytes: native.bavail * native.bsize, totalBytes: native.blocks * native.bsize })
    } finally {
      // This test owns this exact direct child of the native temporary root.
      fs.rmdirSync(dir)
    }
  })
})
