import { describe, expect, it } from 'vitest'
import { visualValidationRequestSchema, visualValidationResultSchema } from './visualValidationContracts'

describe('visual validation contracts', () => {
  it('applies deterministic runner defaults', () => {
    expect(visualValidationRequestSchema.parse({ artifactPath: 'dist/index.html' })).toMatchObject({
      artifactPath: 'dist/index.html',
      timeoutMs: 30_000,
      viewport: { width: 1440, height: 900 },
      captureScreenshot: true,
      captureDom: true,
    })
  })

  it('accepts a complete result with redacted evidence', () => {
    const result = visualValidationResultSchema.safeParse({
      status: 'verified',
      screenshot: { status: 'available', path: 'artifacts/preview.png', width: 1440, height: 900 },
      dom: { status: 'available', content: '<main>Ready</main>' },
      console: [{ level: 'info', message: 'loaded' }],
      http: [{ url: 'http://127.0.0.1:4173/', status: 200, method: 'GET' }],
      redaction: { applied: true, fields: ['url'] },
    })
    expect(result.success).toBe(true)
  })

  it('requires evidence explanations for unavailable or incomplete output', () => {
    expect(visualValidationResultSchema.safeParse({
      status: 'UNAVAILABLE',
      screenshot: { status: 'unavailable' },
      dom: { status: 'unavailable' },
      console: [],
      http: [],
      redaction: { applied: false, fields: [] },
    }).success).toBe(false)
    expect(visualValidationResultSchema.safeParse({
      status: 'verified',
      screenshot: { status: 'available' },
      dom: { status: 'available', content: '<main />' },
      console: [],
      http: [],
      redaction: { applied: false, fields: [] },
    }).success).toBe(false)
  })
})
