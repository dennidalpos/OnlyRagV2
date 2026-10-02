import { describe, expect, it } from 'vitest'
import { citationForSuppliedPassage, resolveAnswerReferences, sourceLocationRequest } from './chatSourceReferences'
import type { VectorSearchResult } from '../types'

const passage: VectorSearchResult = {
  chunk_id: 'doc_chunk_0',
  doc_id: 'doc',
  doc_name: 'contract.md',
  text: '[Document: contract.md | Section: Terms]\n😀 Payment in 21 days.',
  score: 0.2,
  provenance: {
    version: 1,
    source_revision: 'a'.repeat(64),
    extraction_revision: 'b'.repeat(64),
    index_revision: 'c'.repeat(64),
    location_kind: 'original',
    span_start: 20,
    span_end: 41,
    exact_quote: '😀 Payment in 21 days.',
  },
}

describe('revision-bound supplied citations', () => {
  it('maps completed answer references only to passages supplied in this turn', () => {
    const source = citationForSuppliedPassage(passage, passage.text, 'S1')
    const resolved = resolveAnswerReferences('Payment in 21 days [S1]. Another claim [S99] [S01].', [source, { ...source, referenceId: 'S2' }])
    expect(resolved.sources.map((item) => item.citationState)).toEqual(['cited', 'candidate'])
    expect(resolved.invalidSourceReferences).toEqual(['S99', 'S01'])
    expect(source.citationState).toBe('candidate')
    const longestStoredReference = 'S' + '9'.repeat(31)
    expect(resolveAnswerReferences(`[${longestStoredReference}]`, [source]).invalidSourceReferences).toEqual([longestStoredReference])
  })

  it('bounds the original span to the supplied truncated body using Unicode code points', () => {
    const source = citationForSuppliedPassage(passage, '[Document: contract.md | Section: Terms]\n😀 Payment', 'S1')
    expect(source.provenance?.exact_quote).toBe('😀 Payment')
    expect(sourceLocationRequest(source)?.spanEnd).toBe(29)
  })

  it('never offers an original location for legacy, rewritten or incomplete-prefix passages', () => {
    expect(sourceLocationRequest(citationForSuppliedPassage({ ...passage, provenance: undefined }, passage.text, 'S1'))).toBeNull()
    expect(sourceLocationRequest(citationForSuppliedPassage(passage, 'Rewritten Payment', 'S1'))).toBeNull()
    expect(sourceLocationRequest(citationForSuppliedPassage(passage, '[Document: cont', 'S1'))).toBeNull()
  })
})
