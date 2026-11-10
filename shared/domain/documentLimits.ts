import { z } from 'zod'

/** Editing, conversion and new ingestion use the same UTF-16 budget as the desktop editor. */
export const MAX_DOCUMENT_TEXT_UNITS = 10_000_000
export const DOCUMENT_TEXT_LIMIT_MESSAGE = 'Document text exceeds the 10 million UTF-16 unit limit; export as Markdown or split the document.'
// Keep the unit explicit rather than relying on a library version's interpretation of string length.
export const documentTextSchema = z.string().refine((text) => text.length <= MAX_DOCUMENT_TEXT_UNITS, DOCUMENT_TEXT_LIMIT_MESSAGE)
