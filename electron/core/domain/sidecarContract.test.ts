import { describe, expect, it } from 'vitest'
import {
  sidecarExportPayloadSchema,
  sidecarIngestFilePayloadSchema,
  sidecarSearchPayloadSchema,
  sidecarTranslatePayloadSchema,
} from './sidecarContract'

describe('sidecar IPC contract', () => {
  it('accepts bounded ingestion and translation payloads', () => {
    expect(sidecarIngestFilePayloadSchema.parse({ filePath: 'D:/docs/a.pdf', numCtx: 8192 })).toMatchObject({ numCtx: 8192 })
    expect(sidecarTranslatePayloadSchema.parse({ docId: 'doc-1', sourceLang: 'it', targetLang: 'en' })).toMatchObject({ docId: 'doc-1' })
  })

  it('rejects unsafe or oversized payloads before the HTTP adapter', () => {
    expect(() => sidecarIngestFilePayloadSchema.parse({ filePath: ' ' })).toThrow()
    expect(() => sidecarIngestFilePayloadSchema.parse({ filePath: 'a.pdf', numCtx: 2048 })).toThrow()
    expect(() => sidecarTranslatePayloadSchema.parse({ docId: 'x', sourceLang: ' ', targetLang: 'en' })).toThrow()
    expect(() => sidecarSearchPayloadSchema.parse({ query: 'x', topK: 101 })).toThrow()
    expect(() => sidecarExportPayloadSchema.parse({ markdownContent: '# x', format: 'txt' })).toThrow()
  })
})
