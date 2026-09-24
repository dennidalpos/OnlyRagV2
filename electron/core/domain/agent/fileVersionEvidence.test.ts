import { describe, expect, it } from 'vitest'
import {
  MAX_FILE_VERSION_EVIDENCE,
  forgetFileVersion,
  knownFileVersion,
  recordFileVersion,
  restoreFileVersionEvidence,
  type FileVersionEvidence,
} from './fileVersionEvidence'

describe('fileVersionEvidence', () => {
  it('keys paths the way the tools spell them interchangeably', () => {
    const evidence: FileVersionEvidence = {}
    recordFileVersion(evidence, './src\\App.jsx', 'sha256:a')
    expect(knownFileVersion(evidence, 'src/App.jsx')).toBe('sha256:a')
    expect(knownFileVersion(evidence, 'SRC/app.jsx')).toBe('sha256:a')
  })

  it('keeps one version per file, the latest one', () => {
    const evidence: FileVersionEvidence = {}
    recordFileVersion(evidence, 'src/App.jsx', 'sha256:a')
    recordFileVersion(evidence, 'src/main.jsx', 'sha256:m')
    recordFileVersion(evidence, 'src/App.jsx', 'sha256:b')
    expect(evidence).toEqual({ 'src/main.jsx': 'sha256:m', 'src/app.jsx': 'sha256:b' })
  })

  it('forgets a file whose edit conflicted', () => {
    const evidence: FileVersionEvidence = { 'src/app.jsx': 'sha256:a' }
    forgetFileVersion(evidence, 'src/App.jsx')
    expect(knownFileVersion(evidence, 'src/App.jsx')).toBeUndefined()
  })

  it('evicts the least recently seen file past the bound', () => {
    const evidence: FileVersionEvidence = {}
    for (let index = 0; index <= MAX_FILE_VERSION_EVIDENCE; index++) recordFileVersion(evidence, `f${index}.js`, `sha256:${index}`)
    expect(Object.keys(evidence)).toHaveLength(MAX_FILE_VERSION_EVIDENCE)
    expect(knownFileVersion(evidence, 'f0.js')).toBeUndefined()
    expect(knownFileVersion(evidence, `f${MAX_FILE_VERSION_EVIDENCE}.js`)).toBe(`sha256:${MAX_FILE_VERSION_EVIDENCE}`)
  })

  it('restores the single read hash saved by older sessions', () => {
    expect(restoreFileVersionEvidence(undefined, { filePath: 'src/App.tsx', contentHash: 'sha256:old' })).toEqual({ 'src/app.tsx': 'sha256:old' })
    expect(restoreFileVersionEvidence({ 'src/app.tsx': 'sha256:new' }, { filePath: 'src/App.tsx', contentHash: 'sha256:old' })).toEqual({
      'src/app.tsx': 'sha256:new',
    })
    expect(restoreFileVersionEvidence(undefined, undefined)).toEqual({})
  })
})
