import { describe, expect, it } from 'vitest'
import {
  sidecarExportPayloadSchema,
  sidecarIngestFilePayloadSchema,
  sidecarSearchPayloadSchema,
  sidecarTranslatePayloadSchema,
  toIngestionProgressPayload,
  toTranslateProgressPayload,
} from './sidecarContract'

describe('sidecar IPC contract', () => {
  it('accepts bounded ingestion and translation payloads', () => {
    expect(sidecarIngestFilePayloadSchema.parse({ filePath: 'D:/docs/a.pdf', numCtx: 8192, taskId: 'ingest-1' })).toMatchObject({
      numCtx: 8192,
      taskId: 'ingest-1',
    })
    expect(sidecarTranslatePayloadSchema.parse({ docId: 'doc-1', sourceLang: 'it', targetLang: 'en' })).toMatchObject({ docId: 'doc-1' })
    // A vision model trained on 2k tokens (moondream) gets num_ctx 2048 from resolveModelContextLength.
    expect(sidecarIngestFilePayloadSchema.parse({ filePath: 'a.pdf', numCtx: 2048, taskId: 'ingest-1' })).toMatchObject({ numCtx: 2048 })
  })

  it('rejects unsafe or oversized payloads before the HTTP adapter', () => {
    expect(() => sidecarIngestFilePayloadSchema.parse({ filePath: ' ' })).toThrow()
    expect(() => sidecarIngestFilePayloadSchema.parse({ filePath: 'a.pdf', numCtx: 128, taskId: 'ingest-1' })).toThrow()
    expect(() => sidecarIngestFilePayloadSchema.parse({ filePath: 'a.pdf' })).toThrow()
    expect(() => sidecarTranslatePayloadSchema.parse({ docId: 'x', sourceLang: ' ', targetLang: 'en' })).toThrow()
    expect(() => sidecarSearchPayloadSchema.parse({ query: 'x', topK: 101 })).toThrow()
    expect(() => sidecarExportPayloadSchema.parse({ markdownContent: '# x', format: 'txt' })).toThrow()
  })
})

describe('sidecar progress events', () => {
  it('relays ingestion events without the document record the done event carries', () => {
    const done = {
      type: 'done',
      percent: 100,
      step: 'Ingestion and indexing completed successfully!',
      step_code: 'done',
      pipeline: 'Completed',
      fileName: 'a.pdf',
      data: { id: 'doc-1', extracted_markdown: '# A' },
    }
    expect(toIngestionProgressPayload(done, 'ingest-1')).toEqual({
      type: 'done',
      percent: 100,
      step: 'Ingestion and indexing completed successfully!',
      step_code: 'done',
      pipeline: 'Completed',
      fileName: 'a.pdf',
      taskId: 'ingest-1',
    })
    expect(
      toIngestionProgressPayload({ type: 'progress', percent: 10, step_code: 'pdf_pages', step_params: { pages: 3 }, page: 1, total_pages: 3 }, 't'),
    ).toMatchObject({
      step_params: { pages: 3 },
    })
  })

  it('accepts the cancelled and error ingestion events and rejects unknown shapes', () => {
    expect(toIngestionProgressPayload({ type: 'cancelled', task_id: 'ingest-1', fileName: 'a.pdf' }, 'ingest-1')).toEqual({
      type: 'cancelled',
      fileName: 'a.pdf',
      taskId: 'ingest-1',
    })
    expect(toIngestionProgressPayload({ type: 'error', step: 'failed', error: 'boom', fileName: 'a.pdf' }, 'ingest-1')).toMatchObject({ error: 'boom' })
    expect(toIngestionProgressPayload({ type: 'finished' }, 'ingest-1')).toBeNull()
    expect(toIngestionProgressPayload({ type: 'progress', percent: 140 }, 'ingest-1')).toBeNull()
    expect(toIngestionProgressPayload('not an event', 'ingest-1')).toBeNull()
  })

  it('relays translation phases and drops the translated record', () => {
    expect(toTranslateProgressPayload({ type: 'progress', page: 2, total_pages: 4, phase: 'translating_blocks', percent: 37 }, 'translate-1')).toEqual({
      type: 'progress',
      page: 2,
      total_pages: 4,
      phase: 'translating_blocks',
      percent: 37,
      taskId: 'translate-1',
    })
    expect(toTranslateProgressPayload({ type: 'done', data: { id: 'doc-1', status: 'translated' } }, 'translate-1')).toEqual({
      type: 'done',
      taskId: 'translate-1',
    })
    expect(toTranslateProgressPayload({ type: 'progress', phase: 'uploading' }, 'translate-1')).toBeNull()
  })
})
