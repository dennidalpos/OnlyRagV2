import { describe, it, expect } from 'vitest'
import { rejectionAbortSummary } from './toolRejectionEscalation'

describe('rejectionAbortSummary', () => {
  it('reports the real reason and reassures about the work already on disk', () => {
    const summary = rejectionAbortSummary('replace_file_content', 2)

    expect(summary).toContain('replace_file_content')
    expect(summary).toContain('2')
    expect(summary).toContain('restano sul disco')
  })
})
