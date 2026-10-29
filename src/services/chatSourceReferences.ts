import type { CitationSource, SourceLocationRequest, VectorSearchResult } from '../types'

export function citationForSuppliedPassage(result: VectorSearchResult, supplied: string, referenceId: string): CitationSource {
  const body = supplied.startsWith('[Document: ') ? supplied.slice(supplied.indexOf('\n') + 1) : supplied
  let provenance = result.provenance
  if (provenance?.location_kind === 'original') {
    const quote = provenance.exact_quote
    provenance =
      quote && body && quote.startsWith(body) && provenance.span_start != null
        ? { ...provenance, exact_quote: body, span_end: provenance.span_start + [...body].length }
        : { ...provenance, location_kind: 'derived', span_start: null, span_end: null, exact_quote: null }
  }
  return {
    chunkId: result.chunk_id,
    docId: result.doc_id,
    docName: result.doc_name || 'Document',
    sectionHeader: result.section_header,
    snippet: body.slice(0, 150) + (body.length > 150 ? '...' : ''),
    score: result.score,
    referenceId,
    citationState: 'candidate',
    provenance,
  }
}

export function resolveAnswerReferences(text: string, supplied: CitationSource[]) {
  const references = new Set(Array.from(text.matchAll(/\[(S[^\]\n]{1,31})\]/g), (match) => match[1]))
  const valid = new Set(supplied.map((source) => source.referenceId).filter((id): id is string => !!id))
  return {
    sources: supplied.map(
      (source): CitationSource => ({
        ...source,
        citationState: source.referenceId && references.has(source.referenceId) ? 'cited' : 'candidate',
      }),
    ),
    invalidSourceReferences: [...references].filter((id) => !valid.has(id)),
  }
}

export function sourceLocationRequest(source: CitationSource): SourceLocationRequest | null {
  const p = source.provenance
  if (!source.docId || !source.chunkId || p?.location_kind !== 'original' || p.span_start == null || p.span_end == null) return null
  return {
    docId: source.docId,
    chunkId: source.chunkId,
    sourceRevision: p.source_revision,
    extractionRevision: p.extraction_revision,
    indexRevision: p.index_revision,
    spanStart: p.span_start,
    spanEnd: p.span_end,
  }
}
