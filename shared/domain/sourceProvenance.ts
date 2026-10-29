import { z } from 'zod'

const revision = z.string().regex(/^[a-f0-9]{64}$/)
const identifier = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_-]+$/)

export const sourceProvenanceSchema = z
  .object({
    version: z.literal(1),
    source_revision: revision,
    extraction_revision: revision,
    index_revision: revision,
    location_kind: z.enum(['original', 'derived', 'unavailable']),
    page_number: z.number().int().min(1).nullish(),
    section_header: z.string().max(4096).nullish(),
    span_start: z.number().int().nonnegative().nullish(),
    span_end: z.number().int().positive().nullish(),
    exact_quote: z.string().max(10_000).nullish(),
  })
  .strict()
  .refine(
    (value) =>
      value.location_kind !== 'original' ||
      (value.span_start != null &&
        value.span_end != null &&
        value.span_end > value.span_start &&
        !!value.exact_quote &&
        [...value.exact_quote].length === value.span_end - value.span_start),
    'Original locations require an exact code-point span',
  )

export const sourceLocationRequestSchema = z
  .object({
    docId: identifier,
    chunkId: identifier,
    sourceRevision: revision,
    extractionRevision: revision,
    indexRevision: revision,
    spanStart: z.number().int().nonnegative().max(10_000_000),
    spanEnd: z.number().int().positive().max(10_000_000),
  })
  .strict()
  .refine((value) => value.spanEnd > value.spanStart && value.spanEnd - value.spanStart <= 10_000)

export const sourceLocationSchema = z
  .object({
    doc_id: identifier,
    chunk_id: identifier,
    source_revision: revision,
    extraction_revision: revision,
    index_revision: revision,
    page_number: z.number().int().positive().nullish(),
    section_header: z.string().max(4096).nullish(),
    span_start: z.number().int().nonnegative(),
    span_end: z.number().int().positive(),
    exact_quote: z.string().min(1).max(10_000),
    image_base64: z
      .string()
      .max(32_000_000)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/)
      .nullish(),
  })
  .strict()
  .refine((value) => [...value.exact_quote].length === value.span_end - value.span_start)
